'use strict';

// BL-617: step handlers for "Nightly cooldown window pauses the swarm
// overnight". This is a SCHEDULER over BL-423's existing timed-pause
// machinery - these steps drive the REAL compiled cooldownWindowCore.ts/
// cooldownWindowState.ts/apply-cooldown-pause.ts CLI, the REAL
// telegram-front-desk-bot.ts (readControlPauseState/writeControlPauseState/
// resumeNow), the REAL resume-expired-pauses.js CLI (unchanged, BL-423),
// and the REAL handoffd.bb (via its --poll-once flag for the delivery-freeze
// scenario, and a short-lived real backgrounded daemon for the chase-sweep
// suppression scenario, mirroring corruptHandoffNeverDispatchedSteps.js's
// and test_handoffd_pause_suppresses_outbound_wakes.sh's own techniques
// respectively) - never a parallel/simplified reimplementation of any
// decision.
//
// "Local" times in every step below resolve against one fixed baseline
// calendar day (2026-07-24 evening / 2026-07-25 morning) via localTimeToMs:
// any hour < 12 is treated as the early-morning half of the window (the
// NEXT day), everything else as the evening half (the same day) - this
// mirrors cooldownWindowCore.test.js's own fixture convention and correctly
// resolves every literal time this feature file uses.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const HANDOFFD = path.join(SCRIPTS_DIR, 'handoffd.bb');
const APPLY_COOLDOWN_PAUSE_CLI = path.join(EXT_DIR, 'out', 'tools', 'apply-cooldown-pause.js');
const RESUME_EXPIRED_PAUSES_CLI = path.join(EXT_DIR, 'out', 'tools', 'resume-expired-pauses.js');
const RUNBOOK_PATH = path.join(REPO_ROOT, 'docs', 'how-to', 'BL-617-nightly-cooldown-window.md');

const {
  readControlPauseState,
  writeControlPauseState,
  controlPauseStatePath,
  resumeNow,
} = require(path.join(EXT_DIR, 'out', 'tools', 'telegram-front-desk-bot'));
const { cooldownWindowMarkerPath, readCooldownWindowMarker } = require(path.join(EXT_DIR, 'out', 'tools', 'cooldownWindowState'));

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl617-cooldown-'));
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function processEnvAllowlist(overrides = {}) {
  return { PATH: process.env.PATH, HOME: process.env.HOME, ...overrides };
}

// 2026-07-24 19:00 -> 2026-07-25 07:00 is the one continuous window instance
// every literal time in this feature file falls inside or around - an hour
// before noon is always the early-morning half (next day), everything else
// the evening half (same day). Matches cooldownWindowCore.test.js's own
// fixture convention exactly.
function localTimeToMs(hhmm) {
  const [hour, minute] = hhmm.split(':').map(Number);
  const dayOffset = hour < 12 ? 1 : 0;
  return new Date(2026, 6, 24 + dayOffset, hour, minute, 0, 0).getTime();
}

function writeConf(root, lines) {
  mkdirp(path.join(root, 'swarmforge'));
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), lines.join('\n') + '\n');
}

function topicMapPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json');
}

const FORCE_SUCCESS_ENV = { TELEGRAM_NOTIFY_FORCE_RESULT: JSON.stringify({ success: true }) };

function runApplyCooldownPause(ctx, nowMs, extraArgs = []) {
  const env = processEnvAllowlist({ ...(ctx.telegramEnv || {}) });
  const out = execFileSync('node', [APPLY_COOLDOWN_PAUSE_CLI, '--now', String(nowMs), ...extraArgs], {
    encoding: 'utf8',
    cwd: ctx.root,
    env,
  });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^a swarm project with a controllable local clock$/, (ctx) => {
    ctx.root = mkTmp();
    git(ctx.root, ['init', '-q']);
    git(ctx.root, ['config', 'user.email', 't@t']);
    git(ctx.root, ['config', 'user.name', 't']);
    git(ctx.root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    mkdirp(path.join(ctx.root, '.swarmforge', 'operator'));
    fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), `coder\tcoder\t${ctx.root}\tswarmforge-coder\tCoder\tclaude\ttask\n`);
    const sock = path.join(ctx.root, 'fake.sock');
    fs.writeFileSync(sock, '');
    fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'tmux-socket'), sock);
    mkdirp(path.join(ctx.root, '.swarmforge', 'handoffs', 'inbox', 'new'));
    mkdirp(path.join(ctx.root, '.swarmforge', 'handoffs', 'outbox'));
    ctx.inboxNew = path.join(ctx.root, '.swarmforge', 'handoffs', 'inbox', 'new');
    ctx.outbox = path.join(ctx.root, '.swarmforge', 'handoffs', 'outbox');
    ctx.telegramEnv = {};
    ctx.daemonProc = null;
  });

  // ── config / pause-state Givens shared across scenarios ────────────────
  registry.define(/^the cooldown window is enabled from "([^"]+)" to "([^"]+)" local$/, (ctx, start, end) => {
    writeConf(ctx.root, ['config cooldown_window_enabled true', `config cooldown_start_local ${start}`, `config cooldown_end_local ${end}`]);
  });

  registry.define(/^the cooldown window is not enabled$/, (ctx) => {
    writeConf(ctx.root, ['config cooldown_window_enabled false']);
  });

  registry.define(/^the cooldown window is enabled with a malformed start time "([^"]+)"$/, (ctx, malformed) => {
    writeConf(ctx.root, ['config cooldown_window_enabled true', `config cooldown_start_local ${malformed}`]);
  });

  registry.define(/^the cooldown window is enabled with no start or end times configured$/, (ctx) => {
    writeConf(ctx.root, ['config cooldown_window_enabled true']);
  });

  registry.define(/^no pause is active$/, (ctx) => {
    writeControlPauseState(ctx.root, { active: false });
  });

  registry.define(/^the cooldown has not yet been applied for the current window$/, (ctx) => {
    try {
      fs.unlinkSync(cooldownWindowMarkerPath(ctx.root));
    } catch {
      // already absent - the intended state either way.
    }
  });

  registry.define(/^a human-applied pause is active until "([^"]+)" local$/, (ctx, until) => {
    writeControlPauseState(ctx.root, { active: true, untilMs: localTimeToMs(until) });
  });

  registry.define(/^a human-applied pause expired and was auto-resumed at "([^"]+)" local$/, (ctx) => {
    // The auto-resume sweep already ran (BL-423, unchanged) - the state
    // this scenario picks up from is simply "not active" again.
    writeControlPauseState(ctx.root, { active: false });
  });

  registry.define(/^the cooldown applied the current window's pause at "([^"]+)" local$/, (ctx, appliedAt) => {
    const appliedMs = localTimeToMs(appliedAt);
    // A generous future untilMs - which exact value is irrelevant to this
    // scenario, only that a pause is active and the window is marked
    // consumed as of appliedMs.
    writeControlPauseState(ctx.root, { active: true, untilMs: appliedMs + 12 * 60 * 60 * 1000 });
    fs.writeFileSync(cooldownWindowMarkerPath(ctx.root), JSON.stringify({ lastHandledWindowStartMs: appliedMs }));
  });

  registry.define(/^a human resume-now cleared the pause at "([^"]+)" local$/, async (ctx, resumedAt) => {
    await resumeNow(ctx.root, 'fake-token', 'fake-chat', undefined, async () => ({ ok: true, status: 200, json: {} }), localTimeToMs(resumedAt));
  });

  registry.define(/^a human-applied pause with no timer has been active since "([^"]+)" local$/, (ctx) => {
    writeControlPauseState(ctx.root, { active: true, untilMs: undefined });
  });

  registry.define(/^the cooldown pause is active until "([^"]+)" local$/, (ctx, until) => {
    writeControlPauseState(ctx.root, { active: true, untilMs: localTimeToMs(until) });
  });

  registry.define(/^the Telegram Control topic is configured$/, (ctx) => {
    fs.writeFileSync(topicMapPath(ctx.root), JSON.stringify({ '900': 'CONTROL' }));
    ctx.telegramEnv = { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat', ...FORCE_SUCCESS_ENV };
  });

  registry.define(/^no Telegram configuration is present$/, (ctx) => {
    ctx.telegramEnv = {};
  });

  registry.define(/^the shipped repository documentation$/, () => {});

  // ── window-open-applies-timed-pause-01 / window-decision-table-02 ──────
  registry.define(/^the cooldown sweep ticks at "([^"]+)" local$/, (ctx, localTime) => {
    ctx.sweepResult = runApplyCooldownPause(ctx, localTimeToMs(localTime));
  });

  registry.define(/^a timed pause is applied until the next "([^"]+)" local boundary$/, (ctx, boundary) => {
    assert.equal(ctx.sweepResult.decision, 'apply-pause', `expected apply-pause, got: ${JSON.stringify(ctx.sweepResult)}`);
    const expectedUntilMs = localTimeToMs(boundary);
    assert.equal(ctx.sweepResult.untilMs, expectedUntilMs, `expected untilMs=${expectedUntilMs}, got: ${JSON.stringify(ctx.sweepResult)}`);
    const state = readControlPauseState(ctx.root);
    assert.equal(state.active, true, `expected the pause to actually be written, got: ${JSON.stringify(state)}`);
    assert.equal(state.untilMs, expectedUntilMs);
  });

  registry.define(/^the pause state file at "([^"]+)" records an active pause$/, (ctx, relPath) => {
    const onDisk = JSON.parse(fs.readFileSync(controlPauseStatePath(ctx.root), 'utf8'));
    assert.equal(onDisk.active, true, `expected an active pause on disk, got: ${JSON.stringify(onDisk)}`);
    assert.equal(path.relative(ctx.root, controlPauseStatePath(ctx.root)).split(path.sep).join('/'), relPath);
  });

  registry.define(/^the cooldown decision is "([^"]+)"$/, (ctx, decision) => {
    assert.equal(ctx.sweepResult.decision, decision, `expected decision=${decision}, got: ${JSON.stringify(ctx.sweepResult)}`);
  });

  // ── human-pause-at-window-open-untouched-04 ─────────────────────────────
  registry.define(/^the existing pause state is unchanged$/, (ctx) => {
    const state = readControlPauseState(ctx.root);
    assert.equal(state.active, true, `expected the pre-existing human pause to remain active, got: ${JSON.stringify(state)}`);
  });

  // ── malformed-config-no-pause-loud-09 ───────────────────────────────────
  registry.define(/^a malformed cooldown config warning is logged loudly$/, (ctx) => {
    assert.ok(ctx.sweepResult.warning && /malformed/i.test(ctx.sweepResult.warning), `expected a loud malformed-config warning, got: ${JSON.stringify(ctx.sweepResult)}`);
  });

  // ── morning-auto-resume-thaw-03 ──────────────────────────────────────────
  registry.define(/^the pause auto-resume sweep ticks at "([^"]+)" local$/, (ctx) => {
    // resume-expired-pauses.js (BL-423, unchanged) has no injected clock -
    // its own decision is against the real wall clock, so the Given step
    // above must already have set an untilMs in the real past for this to
    // fire (mirroring bl423TelegramSwarmControlVerbsSteps.js's own
    // "control-pause-autoresume-15" fixture, which does the same).
    writeControlPauseState(ctx.root, { active: true, untilMs: Date.now() - 1000 });
    fs.writeFileSync(topicMapPath(ctx.root), JSON.stringify({ '900': 'CONTROL' }));
    const env = processEnvAllowlist({ TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat', ...FORCE_SUCCESS_ENV });
    ctx.sweepResult = JSON.parse(execFileSync('node', [RESUME_EXPIRED_PAUSES_CLI], { encoding: 'utf8', cwd: ctx.root, env }));
  });

  registry.define(/^the pause is cleared$/, (ctx) => {
    assert.equal(ctx.sweepResult.resumed, true, `expected the sweep to resume, got: ${JSON.stringify(ctx.sweepResult)}`);
    assert.equal(readControlPauseState(ctx.root).active, false);
  });

  registry.define(/^a resume announcement is posted to the Control topic$/, (ctx) => {
    assert.equal(ctx.sweepResult.announced, true, `expected an announcement, got: ${JSON.stringify(ctx.sweepResult)}`);
  });

  // ── pause-announcement-posted-13 / pause-applies-without-telegram-14 ───
  registry.define(/^the cooldown applies the current window's pause$/, (ctx) => {
    try {
      fs.unlinkSync(cooldownWindowMarkerPath(ctx.root));
    } catch {
      // absent already - fine.
    }
    writeControlPauseState(ctx.root, { active: false });
    ctx.sweepResult = runApplyCooldownPause(ctx, localTimeToMs('19:03'));
  });

  registry.define(/^a cooldown pause announcement naming the resume time is posted to the Control topic$/, (ctx) => {
    assert.equal(ctx.sweepResult.decision, 'apply-pause');
    assert.equal(ctx.sweepResult.announced, true, `expected the pause announcement, got: ${JSON.stringify(ctx.sweepResult)}`);
  });

  registry.define(/^the pause is still applied$/, (ctx) => {
    assert.equal(ctx.sweepResult.decision, 'apply-pause');
    assert.equal(readControlPauseState(ctx.root).active, true, 'expected the pause to be written even without Telegram configured');
  });

  registry.define(/^the pause apply completes without error and skips the announcement$/, (ctx) => {
    assert.equal(ctx.sweepResult.announced, false);
    assert.equal(ctx.sweepResult.reason, 'missing-telegram-config');
  });

  // ── delivery-frozen-not-killed-11 ────────────────────────────────────────
  registry.define(/^an agent enqueues a git_handoff parcel at "([^"]+)" local$/, (ctx) => {
    ctx.parcelName = '50_from_coder_to_coder.handoff';
    fs.writeFileSync(
      path.join(ctx.outbox, ctx.parcelName),
      'id: p1\nfrom: coder\nto: coder\npriority: 50\ntype: note\nmessage: fresh parcel\n\nfresh parcel\n'
    );
  });

  registry.define(/^the parcel is accepted into the outbound queue$/, (ctx) => {
    assert.ok(fs.existsSync(path.join(ctx.outbox, ctx.parcelName)), 'expected the parcel to land in outbox/');
  });

  registry.define(/^the parcel is not delivered to the recipient inbox while the pause is active$/, (ctx) => {
    execFileSync('bb', [HANDOFFD, ctx.root, '--poll-once'], {
      encoding: 'utf8',
      env: processEnvAllowlist({ SWARMFORGE_ALLOW_TMP_DAEMON: '1' }),
    });
    assert.ok(fs.existsSync(path.join(ctx.outbox, ctx.parcelName)), 'expected the parcel to remain un-delivered (still in outbox/) while paused');
    assert.equal(fs.readdirSync(ctx.inboxNew).length, 0, 'expected coder inbox/new to stay empty while paused');
  });

  registry.define(/^no agent pane is killed by the cooldown$/, () => {
    // poll-once! never touches tmux at all when paused (the whole delivery
    // loop is skipped before any tmux call) - nothing to assert against a
    // fake tmux binary here beyond the absence already proven above.
  });

  registry.define(/^the pause clears at "([^"]+)" local$/, (ctx) => {
    writeControlPauseState(ctx.root, { active: false });
    if (!ctx.daemonProc) {
      execFileSync('bb', [HANDOFFD, ctx.root, '--poll-once'], {
        encoding: 'utf8',
        env: processEnvAllowlist({ SWARMFORGE_ALLOW_TMP_DAEMON: '1' }),
      });
    }
  });

  registry.define(/^the parcel is delivered within one sweep cadence$/, (ctx) => {
    assert.ok(!fs.existsSync(path.join(ctx.outbox, ctx.parcelName)), 'expected the parcel to leave outbox/ once the pause cleared');
    const delivered = fs.readdirSync(ctx.inboxNew).some((f) => f.includes('from_coder_to_coder'));
    assert.ok(delivered, 'expected the parcel to land in inbox/new once the pause cleared');
  });

  // ── chase-nudges-suppressed-12 (real short-lived backgrounded daemon) ───
  registry.define(/^a parcel has sat in a role inbox beyond the stuck threshold$/, (ctx) => {
    const stuckFile = path.join(ctx.inboxNew, '00_20260701T000000Z_000001_from_specifier_to_coder.handoff');
    fs.writeFileSync(stuckFile, 'id: t\nfrom: specifier\nto: coder\npriority: 00\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n');
    const aged = new Date(Date.now() - 45_000);
    fs.utimesSync(stuckFile, aged, aged);
    ctx.stuckFile = stuckFile;

    const fakeBin = path.join(ctx.root, 'bin');
    mkdirp(fakeBin);
    ctx.tmuxLog = path.join(ctx.root, 'tmux-calls.log');
    fs.writeFileSync(path.join(fakeBin, 'tmux'), `#!/usr/bin/env bash\necho "$*" >> ${ctx.tmuxLog}\nexit 0\n`, { mode: 0o755 });

    ctx.daemonProc = spawn('bb', [HANDOFFD, ctx.root], {
      env: processEnvAllowlist({ SWARMFORGE_ALLOW_TMP_DAEMON: '1', PATH: `${fakeBin}:${process.env.PATH}` }),
      stdio: 'ignore',
    });
  });

  registry.define(/^the chase sweep ticks at "([^"]+)" local$/, () => {
    // The real daemon (started above) ticks its own chase-sweep cadence on
    // its own wall clock - "at 23:00 local" is flavor text for a paused
    // window, not a literal clock this real subprocess is driven by; the
    // wait below gives its real ~10s cadence time to fire at least once.
  });

  registry.define(/^no chase nudge or wake is sent while the pause is active$/, async (ctx) => {
    await new Promise((resolve) => setTimeout(resolve, 12_000));
    const tmuxCalls = fs.existsSync(ctx.tmuxLog) ? fs.readFileSync(ctx.tmuxLog, 'utf8') : '';
    assert.ok(!/send-keys/.test(tmuxCalls), `expected NO wake (send-keys) while paused, got: ${tmuxCalls}`);
  });

  registry.define(/^the stale parcel is chased normally again$/, async (ctx) => {
    let tmuxCalls = '';
    for (let i = 0; i < 40; i++) {
      tmuxCalls = fs.existsSync(ctx.tmuxLog) ? fs.readFileSync(ctx.tmuxLog, 'utf8') : '';
      if (/send-keys/.test(tmuxCalls)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    mkdirp(path.join(ctx.root, '.swarmforge', 'daemon'));
    fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'daemon', 'stop'), '');
    await new Promise((resolve) => {
      ctx.daemonProc.on('exit', resolve);
      setTimeout(resolve, 5000);
    });
    assert.ok(/send-keys/.test(tmuxCalls), `expected the stale parcel to be chased (send-keys) once the pause cleared, got: ${tmuxCalls}`);
  });

  // ── runbook-names-pause-path-15 ──────────────────────────────────────────
  registry.define(/^the runbook "([^"]+)" is read$/, (ctx, relPath) => {
    ctx.runbook = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
  });

  registry.define(/^it names the pause state file path "([^"]+)"$/, (ctx, expectedPath) => {
    assert.ok(ctx.runbook.includes(expectedPath), `expected the runbook to name ${expectedPath}`);
  });

  registry.define(/^it names the cooldown window config keys$/, (ctx) => {
    for (const key of ['cooldown_window_enabled', 'cooldown_start_local', 'cooldown_end_local']) {
      assert.ok(ctx.runbook.includes(key), `expected the runbook to name the config key ${key}`);
    }
  });
}

module.exports = { registerSteps };
