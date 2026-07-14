'use strict';

// BL-209: step handlers for the rate-limit-cooldown feature.
//
// DETECT + RECORD scenarios (detect-and-record-01, ordinary-output-noop-04)
// drive the real, compiled extension module (extension/out/swarm/
// rateLimitCooldownDetector.js) - no VS Code API. Compiled output only: run
// `npm run compile` in extension/ first.
//
// ENFORCE + RESUME scenarios (suppress-wake-02, resume-at-reset-03) drive
// the real chase_sweep_lib.bb through chase_sweep_test_runner.bb - the same
// harness swarmforge/scripts/test/test_chase_sweep.sh uses - with an
// explicit fake now-ms and fake adapters (no live tmux, no real timers).
// This is the LIVE daemon sweep the ticket requires (not the retired
// inboxChaser.runSweep).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const {
  recordRateLimitCooldownIfPresent,
  rateLimitCooldownFilePath,
} = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'swarm', 'rateLimitCooldownDetector.js'));
const { loadCooldownState } = require(path.join(
  __dirname,
  '..',
  '..',
  '..',
  'extension',
  'out',
  'swarm',
  'cooldownScheduler.js'
));

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const RUNNER = path.join(SWARMFORGE_SCRIPTS, 'test', 'chase_sweep_test_runner.bb');

const NOW_MS = 1751500000 * 1000;
const CHASE_TIMEOUT_S = 30;
const STUCK_TIMEOUT_S = 60;
const MAX_CHASES = 3;
const ROLE = 'coder';

function ensureSweepFixture(ctx) {
  if (!ctx.sweepRoot) {
    ctx.sweepRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-rate-limit-sweep-'));
    fs.mkdirSync(path.join(ctx.sweepRoot, 'inbox', 'new'), { recursive: true });
    fs.mkdirSync(path.join(ctx.sweepRoot, 'inbox', 'in_process'), { recursive: true });
  }
  return ctx.sweepRoot;
}

function writeStaleInboxItem(sweepRoot) {
  const itemPath = path.join(sweepRoot, 'inbox', 'new', '00_item.handoff');
  fs.writeFileSync(
    itemPath,
    'id: t\nfrom: specifier\nto: coder\npriority: 50\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n'
  );
  const staleMtimeS = Math.floor(NOW_MS / 1000) - CHASE_TIMEOUT_S - 5;
  fs.utimesSync(itemPath, staleMtimeS, staleMtimeS);
}

function runSweep(sweepRoot) {
  return execFileSync('bb', [RUNNER, sweepRoot, String(NOW_MS), 'unknown', String(NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CHASE_TIMEOUT_SECONDS: String(CHASE_TIMEOUT_S),
      STUCK_TIMEOUT_SECONDS: String(STUCK_TIMEOUT_S),
      MAX_CHASES: String(MAX_CHASES),
    },
  });
}

function callsLog(sweepRoot) {
  try {
    return fs.readFileSync(path.join(sweepRoot, 'calls.log'), 'utf8');
  } catch {
    return '';
  }
}

function registerSteps(registry) {
  // ── DETECT + RECORD ──────────────────────────────────────────────────
  registry.define(/^a role's agent pane emits a provider usage-limit message stating a reset time$/, (ctx) => {
    ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-rate-limit-detect-'));
    ctx.role = ROLE;
    ctx.paneText = 'thinking...\nClaude usage limit reached. Resets at 18:00.\n';
    ctx.nowMs = new Date('2026-07-10T17:00:00Z').getTime();
  });

  registry.define(/^a role's pane output contains no usage-limit message$/, (ctx) => {
    ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-rate-limit-detect-'));
    ctx.role = ROLE;
    ctx.paneText = 'implementing the feature\nrunning tests\n';
    ctx.nowMs = new Date('2026-07-10T17:00:00Z').getTime();
  });

  registry.define(/^the extension processes that pane output$/, (ctx) => {
    recordRateLimitCooldownIfPresent(ctx.targetPath, ctx.role, ctx.paneText, ctx.nowMs);
  });

  registry.define(/^a cooldown is recorded for that role until the parsed reset time$/, (ctx) => {
    const state = loadCooldownState(rateLimitCooldownFilePath(ctx.targetPath));
    const expected = new Date('2026-07-10T18:00:00Z').getTime();
    if (!state[ctx.role] || state[ctx.role].untilMs !== expected) {
      throw new Error(`expected a cooldown for ${ctx.role} until ${expected}, got: ${JSON.stringify(state)}`);
    }
  });

  registry.define(/^no rate-limit cooldown is recorded$/, (ctx) => {
    const state = loadCooldownState(rateLimitCooldownFilePath(ctx.targetPath));
    if (state[ctx.role]) {
      throw new Error(`expected no cooldown recorded for ${ctx.role}, got: ${JSON.stringify(state[ctx.role])}`);
    }
  });

  // ── ENFORCE + RESUME (live daemon sweep) ─────────────────────────────
  registry.define(/^a role has a recorded rate-limit cooldown that has not yet expired$/, (ctx) => {
    const sweepRoot = ensureSweepFixture(ctx);
    writeStaleInboxItem(sweepRoot);
    fs.writeFileSync(
      path.join(sweepRoot, 'rate-limit-cooldown.json'),
      JSON.stringify({ [ROLE]: { untilMs: NOW_MS + 60000 } })
    );
  });

  registry.define(/^a role whose rate-limit cooldown reset time has passed$/, (ctx) => {
    const sweepRoot = ensureSweepFixture(ctx);
    writeStaleInboxItem(sweepRoot);
    fs.writeFileSync(
      path.join(sweepRoot, 'rate-limit-cooldown.json'),
      JSON.stringify({ [ROLE]: { untilMs: NOW_MS - 1000 } })
    );
  });

  registry.define(/^the live daemon chase\/wake sweep runs$/, (ctx) => {
    const sweepRoot = ensureSweepFixture(ctx);
    ctx.sweepOutput = runSweep(sweepRoot);
  });

  registry.define(/^it does not send that role a wake or retry$/, (ctx) => {
    const log = callsLog(ctx.sweepRoot);
    if (log.trim().length > 0) {
      throw new Error(`expected no wake/retry calls while cooling down, got: ${log}`);
    }
  });

  registry.define(/^the role is woken once to resume work$/, (ctx) => {
    const log = callsLog(ctx.sweepRoot);
    if (!/^wake-up coder$/m.test(log)) {
      throw new Error(`expected the role to be woken once, got calls.log: ${log}`);
    }
  });

  registry.define(/^its rate-limit cooldown is cleared so it does not re-trigger$/, (ctx) => {
    const state = JSON.parse(fs.readFileSync(path.join(ctx.sweepRoot, 'rate-limit-cooldown.json'), 'utf8'));
    if (state[ROLE].wokenForUntilMs !== NOW_MS - 1000) {
      throw new Error(`expected the cooldown marked woken (not re-triggering), got: ${JSON.stringify(state)}`);
    }
    // A second sweep against this now-marked-woken state must not re-wake -
    // proves it will not re-trigger. Uses its own EMPTY-inbox fixture: the
    // first sweep's stale item already has a chase sidecar, and a second
    // sweep over it would fire an ordinary (non-rate-limit) re-chase that
    // logs the identical "wake-up coder" line, making this assertion
    // ambiguous - same lesson as test_chase_sweep.sh's 09b scenario.
    const freshRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-rate-limit-sweep-2nd-'));
    fs.mkdirSync(path.join(freshRoot, 'inbox', 'new'), { recursive: true });
    fs.mkdirSync(path.join(freshRoot, 'inbox', 'in_process'), { recursive: true });
    fs.writeFileSync(path.join(freshRoot, 'rate-limit-cooldown.json'), JSON.stringify(state));
    runSweep(freshRoot);
    const log = callsLog(freshRoot);
    if (/^wake-up coder$/m.test(log)) {
      throw new Error(`expected no re-wake on a second sweep for the same cooldown, got: ${log}`);
    }
  });
}

module.exports = { registerSteps };
