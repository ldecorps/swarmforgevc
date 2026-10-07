'use strict';

// Scaffolded by scaffold_step_handler.js from specs/features/BL-2055-a-local-seat-restart-relaunches-only-on-the-parcel-it-holds.feature (BL-1979).
// Fill in each stub below - this header records where it began.
//
// Scenarios 01/02 drive the REAL `local-model)` case block from
// swarmforge.sh (the same awk extraction
// swarmforge/scripts/test/test_bl1991_local_seat_restart_launch.sh uses)
// under zsh, against a fake qwen that logs its own invocations - the
// launch script's own relaunch loop is what this ticket fixes, so the
// acceptance driver runs the real generated script text, never a
// restatement of its logic.
//
// Scenario 03 drives the REAL local_model_repeat_guard.bb `answer` via
// bl1992ReleaseGuardCli.bb (fake kill-fn, REAL release-parcel! - the same
// driver BL-1992's own step handler uses), because "no note is sent to the
// coordinator" needs a release path that could really send one, not a
// no-op release-fn that would make that assertion vacuous.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = "BL-2055 A local seat's restart relaunches it only on the parcel it holds now";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const RELEASE_GUARD_CLI = path.join(__dirname, 'lib', 'bl1992ReleaseGuardCli.bb');

// ── scenarios 01/02: the launch script's relaunch loop ──────────────────

function extractLocalModelCase() {
  const text = fs.readFileSync(SWARMFORGE_SH, 'utf8');
  const lines = text.split('\n');
  const out = [];
  let flag = false;
  for (const line of lines) {
    if (/^    local-model\)/.test(line)) {
      flag = true;
    }
    if (flag) {
      out.push(line);
      if (/^      ;;/.test(line)) {
        break;
      }
    }
  }
  return out.join('\n');
}

// BL-968: module load is requires and pure constants only - reading
// swarmforge.sh happens lazily, the first time a scenario actually needs
// it, memoized after that, never at require() time (the standing guard
// materializes this registry into a tree with no swarmforge/ at all).
let caseTextCache;
function localModelCaseText() {
  if (caseTextCache === undefined) {
    caseTextCache = extractLocalModelCase();
    assert.ok(caseTextCache, `local-model) case not found in ${SWARMFORGE_SH}`);
  }
  return caseTextCache;
}

function buildLaunchFixture() {
  const root = trackedTmpRoot('sfvc-bl2055-launch-');
  const bin = path.join(root, 'bin');
  const inProcessDir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  const restartDir = path.join(root, '.swarmforge', 'local-seat-restart');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(inProcessDir, { recursive: true });
  fs.mkdirSync(restartDir, { recursive: true });

  const harnessPath = path.join(root, 'harness.zsh');
  const launchBodyPath = path.join(root, 'launch_body.sh');
  fs.writeFileSync(
    harnessPath,
    [
      '#!/usr/bin/env zsh',
      'function swarm_only_strip_seat_tier() { echo "$1"; }',
      `local role_worktree=${quoteZsh(root)}`,
      `local prompt_file=${quoteZsh(path.join(root, 'card.md'))}`,
      'local extra_cli=""',
      'local agent="local-model"',
      'local launch_body=""',
      'case "$agent" in',
      localModelCaseText(),
      'esac',
      `print -r -- "$launch_body" > ${quoteZsh(launchBodyPath)}`,
      '',
    ].join('\n')
  );
  execFileSync('zsh', ['-f', harnessPath], { encoding: 'utf8' });
  assert.ok(fs.statSync(launchBodyPath).size > 0, 'the case block produced no launch_body');

  return { root, bin, inProcessDir, restartDir, launchBodyPath, callsLog: path.join(root, 'qwen_calls.log') };
}

function quoteZsh(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function writeFakeQwen(fx) {
  const qwenPath = path.join(fx.bin, 'qwen');
  fs.writeFileSync(
    qwenPath,
    ['#!/usr/bin/env zsh', `echo "QWEN_INVOKED $*" >> ${quoteZsh(fx.callsLog)}`, 'exit 0', ''].join('\n')
  );
  fs.chmodSync(qwenPath, 0o755);
  fs.writeFileSync(fx.callsLog, '');
}

function runLaunchBody(fx) {
  writeFakeQwen(fx);
  return execFileSync('zsh', ['-f', '-c', `set -euo pipefail; source ${quoteZsh(fx.launchBodyPath)}; echo SCRIPT_FINISHED`], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:/usr/bin:/bin`, LOCAL_RESUME_NOTE: '' },
  });
}

function qwenCalls(fx) {
  return fs
    .readFileSync(fx.callsLog, 'utf8')
    .split('\n')
    .filter(Boolean);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(new RegExp('^a local coder seat whose in_process holds a parcel with a pending override$'), (ctx) => {
    const fx = buildLaunchFixture();
    fs.writeFileSync(path.join(fx.inProcessDir, 'held.handoff'), 'type: git_handoff\nto: coder\n');
    fs.writeFileSync(path.join(fx.restartDir, 'held.handoff.json.msg'), 'HELD-OVERRIDE-TEXT');
    ctx.bl2055Launch = fx;
  });

  scoped(new RegExp('^the restart directory also holds a pending override for an earlier parcel that is no longer in in_process, named to sort first$'), (ctx) => {
    const fx = ctx.bl2055Launch;
    fs.writeFileSync(path.join(fx.restartDir, 'aaa_earlier_parcel.handoff.json.msg'), 'STALE-EARLIER-OVERRIDE-TEXT');
  });

  scoped(new RegExp('^qwen exits and the launch script looks for a pending override$'), (ctx) => {
    const fx = ctx.bl2055Launch;
    const out = runLaunchBody(fx);
    assert.match(out, /SCRIPT_FINISHED/, `the launch script did not reach the end: ${out}`);
    fx.calls = qwenCalls(fx);
  });

  scoped(new RegExp('^qwen is relaunched with the override for the parcel in in_process as its only message$'), (ctx) => {
    const fx = ctx.bl2055Launch;
    assert.equal(fx.calls.length, 2, `expected a kickoff plus one relaunch, got:\n${fx.calls.join('\n')}`);
    assert.match(fx.calls[1], /HELD-OVERRIDE-TEXT/, `the relaunch did not carry the held parcel's override: ${fx.calls[1]}`);
    assert.doesNotMatch(fx.calls[1], /STALE-EARLIER-OVERRIDE-TEXT/, `the relaunch served the earlier parcel's override: ${fx.calls[1]}`);
  });

  scoped(new RegExp('^no pending override for the earlier parcel is left$'), (ctx) => {
    const fx = ctx.bl2055Launch;
    assert.ok(
      !fs.existsSync(path.join(fx.restartDir, 'aaa_earlier_parcel.handoff.json.msg')),
      'the earlier parcel\'s override was not discarded'
    );
  });

  scoped(new RegExp('^a local coder seat whose in_process holds no parcel$'), (ctx) => {
    ctx.bl2055Launch = buildLaunchFixture();
  });

  scoped(new RegExp('^qwen is not relaunched with that override$'), (ctx) => {
    const fx = ctx.bl2055Launch;
    assert.equal(fx.calls.length, 1, `expected only the kickoff, got:\n${fx.calls.join('\n')}`);
  });

  // ── scenario 03: the repeat guard's own in-process-handoff-name ───────

  scoped(new RegExp("^a local coder seat whose in_process holds only the released parcel's claim-progress sidecar$"), (ctx) => {
    const root = trackedTmpRoot('sfvc-bl2055-guard-');
    execFileSync('git', ['-C', root, 'init', '-q', '-b', 'main']);
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);

    const inProcessDir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
    fs.mkdirSync(inProcessDir, { recursive: true });
    const sidecarName = 'released_parcel.handoff.claim-progress.json';
    fs.writeFileSync(path.join(inProcessDir, sidecarName), JSON.stringify({ claimed_at: '2026-10-07T00:00:00Z' }));

    fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'roles.tsv'),
      ['coder', 'coder-wt', root, 'swarmforge-coder', 'Coder', 'local-model', 'task'].join('\t') + '\n'
    );

    ctx.bl2055Guard = {
      root,
      sidecarName,
      transcriptPath: path.join(root, 'transcript.jsonl'),
      killedFile: path.join(root, 'killed.flag'),
    };
  });

  scoped(new RegExp('^the seat\'s latest compaction names a write of tmp/notes\\.md as its next step$'), (ctx) => {
    const g = ctx.bl2055Guard;
    g.nextStep = 'Write tmp/notes.md and run its feature.';
    fs.writeFileSync(g.transcriptPath, compactionLine(g.nextStep));
  });

  scoped(new RegExp('^the seat has made two tool calls since that compaction, neither of them the named write$'), (ctx) => {
    const g = ctx.bl2055Guard;
    appendTranscript(g, callLine('read_file', { file_path: '/bl2055-probe-1' }));
    appendTranscript(g, callLine('read_file', { file_path: '/bl2055-probe-2' }));
  });

  scoped(new RegExp('^the seat makes a third tool call that is not the named write$'), (ctx) => {
    const g = ctx.bl2055Guard;
    const call = { name: 'read_file', args: { file_path: '/bl2055-probe-3' } };
    appendTranscript(g, callLine(call.name, call.args));
    invokeReleaseGuard(g, call.name, call.args);
  });

  scoped(new RegExp("^the seat's qwen process is not restarted$"), (ctx) => {
    const g = ctx.bl2055Guard;
    assert.equal(g.killed, false, 'the fake process controller must not have been told to end qwen');
    const msgFile = path.join(g.root, '.swarmforge', 'local-seat-restart', `${g.sidecarName}.json.msg`);
    assert.ok(!fs.existsSync(msgFile), 'no pending override may be left for the launcher');
  });

  scoped(new RegExp('^no note is sent to the coordinator$'), (ctx) => {
    const g = ctx.bl2055Guard;
    const outboxDir = path.join(g.root, '.swarmforge', 'handoffs', 'outbox');
    const notes = fs.existsSync(outboxDir)
      ? fs
          .readdirSync(outboxDir)
          .filter((f) => f.endsWith('.handoff'))
          .map((f) => fs.readFileSync(path.join(outboxDir, f), 'utf8'))
          .filter((c) => /^type: note$/m.test(c) && /^to: coordinator$/m.test(c))
      : [];
    assert.deepEqual(notes, [], `expected no note to coordinator, got:\n${notes.join('\n---\n')}`);
  });
}

function compactionLine(nextStep) {
  const payload = {
    type: 'system',
    subtype: 'chat_compression',
    systemPayload: {
      compressedHistory: [{ role: 'user', parts: [{ text: `<state_snapshot>\n<next_step>\n${nextStep}\n</next_step>\n</state_snapshot>` }] }],
    },
  };
  return JSON.stringify(payload) + '\n';
}

function callLine(name, args) {
  return JSON.stringify({ type: 'assistant', message: { role: 'model', parts: [{ functionCall: { name, args } }] } }) + '\n';
}

function appendTranscript(g, line) {
  fs.appendFileSync(g.transcriptPath, line);
}

function invokeReleaseGuard(g, name, args) {
  const eventPath = path.join(g.root, 'event.json');
  fs.writeFileSync(
    eventPath,
    JSON.stringify({
      tool_name: name,
      tool_input: args,
      transcript_path: g.transcriptPath,
      cwd: g.root,
      hook_event_name: 'PostToolUse',
    })
  );
  fs.rmSync(g.killedFile, { force: true });
  const out = execFileSync('bb', [RELEASE_GUARD_CLI, eventPath, g.killedFile], {
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ROLE: 'coder', SWARMFORGE_SKIP_SYNC_INJECT: '1' },
  });
  g.lastOutput = out;
  g.killed = fs.existsSync(g.killedFile);
}

module.exports = { registerSteps };
