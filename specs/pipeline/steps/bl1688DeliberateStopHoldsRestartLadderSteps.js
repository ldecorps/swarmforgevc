'use strict';

// BL-1688: step handlers for "a deliberate stop holds the daemon restart
// ladder". Scenarios 01-02 drive the REAL start_handoff_daemon.sh (via
// swarmforge/scripts/test/bl1688_start_owner_acceptance_runner.sh, which
// builds its own throwaway fixture and intercepts the daemon command with
// a recorded fake - never a real bb handoffd.bb). Scenario 03 drives the
// REAL handoffd_supervisor.bb respond-to-verdict! wiring via the extended
// bl1492RestartInPlaceCli.bb fixture (ticks > 1). Scenario 04 drives the
// REAL handoffd_supervisor.bb check! (--check-once) and the REAL
// start_handoff_daemon.sh against a fixture with no tmux-socket file. No
// reimplementation of any decision logic in any scenario.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1688 a deliberate stop holds the daemon restart ladder';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const START_OWNER_RUNNER = path.join(SCRIPTS_DIR, 'test', 'bl1688_start_owner_acceptance_runner.sh');
const RESTART_CLI = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'lib', 'bl1492RestartInPlaceCli.bb');
const SUPERVISOR_BB = path.join(SCRIPTS_DIR, 'handoffd_supervisor.bb');
const HANDOFFD_BB = path.join(SCRIPTS_DIR, 'handoffd.bb');

function parseReport(stdout) {
  const report = {};
  for (const line of stdout.split('\n')) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    report[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return report;
}

function runStartOwner(env) {
  const result = execFileSync('bash', [START_OWNER_RUNNER], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return parseReport(result);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────────
  scoped(
    /^a fixture project root under a temporary directory with a daemon directory, a roles file and no tmux-socket file$/,
    (ctx) => {
      ctx.root = trackedTmpRoot('bl1688-fixture-');
      fs.mkdirSync(path.join(ctx.root, '.swarmforge', 'daemon'), { recursive: true });
      fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), '');
    }
  );

  scoped(/^the start owner's daemon command is replaced by a recorded fake that never launches a daemon$/, () => {
    // Documented, not acted on here - each of scenarios 01/02's own When
    // step drives bl1688_start_owner_acceptance_runner.sh, which builds
    // this exact substitution (a fake `bb` on PATH intercepting
    // HANDOFFD_BB/HANDOFFD_SUPERVISOR_BB) inside its own throwaway root,
    // never this Background step's fixture root.
  });

  // ── Scenario 01 ───────────────────────────────────────────────────────────
  scoped(/^the handoffd\.stopped marker is present under the fixture's freshness-stopped directory$/, (ctx) => {
    ctx.markerPresent = true;
  });

  scoped(/^the supervisor's stop file is present$/, (ctx) => {
    ctx.stopFilePresent = true;
  });

  scoped(/^the status file carries one restart_history entry$/, (ctx) => {
    ctx.restartHistorySeeded = true;
  });

  scoped(/^the start owner is invoked with the caller "([^"]+)"$/, (ctx, caller) => {
    ctx.report = runStartOwner({
      BL1688_MARKER: ctx.markerPresent ? '1' : '0',
      BL1688_STOPFILE: ctx.stopFilePresent ? '1' : '0',
      BL1688_RESTART_HISTORY: ctx.restartHistorySeeded ? '1' : '0',
      BL1688_CALLER: caller,
    });
  });

  scoped(/^it exits non-zero and the recorded fake is never launched$/, (ctx) => {
    assert.notEqual(ctx.report.EXIT_CODE, '0', `expected a non-zero exit, got ${ctx.report.EXIT_CODE}`);
    assert.equal(ctx.report.FAKE_LAUNCH_COUNT, '0', `expected the fake to never launch, got ${ctx.report.FAKE_LAUNCH_COUNT}`);
  });

  scoped(/^the start audit's last line names the handoffd\.stopped marker as the reason$/, (ctx) => {
    assert.match(ctx.report.AUDIT_LAST_LINE, /handoffd\.stopped marker present/);
  });

  scoped(/^the marker, the stop file and the status file are byte-identical to before$/, (ctx) => {
    assert.equal(ctx.report.MARKER_PRESENT_AFTER, '1', 'expected the marker to still be present');
    assert.equal(ctx.report.STOPFILE_PRESENT_AFTER, '1', 'expected the stop file to still be present');
    assert.equal(ctx.report.STATUS_BYTE_IDENTICAL, '1', 'expected the status file to be untouched');
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────────
  scoped(/^the marker and the stop file are gone$/, (ctx) => {
    assert.equal(ctx.report.MARKER_PRESENT_AFTER, '0', 'expected the marker to be cleared');
    assert.equal(ctx.report.STOPFILE_PRESENT_AFTER, '0', 'expected the stop file to be cleared');
  });

  scoped(/^the recorded fake is launched exactly once$/, (ctx) => {
    assert.equal(ctx.report.EXIT_CODE, '0', `expected a clean exit, got ${ctx.report.EXIT_CODE}`);
    assert.equal(ctx.report.FAKE_LAUNCH_COUNT, '1', `expected the fake to launch exactly once, got ${ctx.report.FAKE_LAUNCH_COUNT}`);
  });

  // ── Scenario 03 ───────────────────────────────────────────────────────────
  scoped(/^a supervisor whose restart budget is 2 restarts per 600000 ms$/, () => {
    // The unmodified default (SUPERVISOR_RESTART_BUDGET_COUNT=2,
    // SUPERVISOR_RESTART_BUDGET_WINDOW_MS=600000) - nothing to configure.
  });

  scoped(/^a start owner that fails to claim on every invocation and rewrites the status file the way the real one does$/, (ctx) => {
    ctx.startOwnerFails = true;
  });

  scoped(/^the supervisor acts on a "([^"]+)" verdict three times within the window$/, (ctx, verdict) => {
    const input = JSON.stringify({ verdict, restartHistory: [], startOwnerFails: !!ctx.startOwnerFails, ticks: 3 });
    const result = spawnSync('bb', [RESTART_CLI], { input, encoding: 'utf8' });
    assert.equal(result.status, 0, `bl1492RestartInPlaceCli.bb failed: ${result.stderr}`);
    ctx.budgetResult = JSON.parse(result.stdout);
  });

  scoped(/^the start owner is invoked exactly twice$/, (ctx) => {
    assert.equal(ctx.budgetResult.startDaemonCount, 2);
  });

  scoped(/^the status file's restart_history carries two "([^"]+)" entries before the third verdict$/, (ctx, resultWord) => {
    const entries = ctx.budgetResult.restartHistoryAfter;
    assert.equal(entries.length, 2, `expected 2 restart_history entries, got ${entries.length}`);
    for (const entry of entries) {
      assert.equal(entry.result, resultWord, `expected every entry's result to be "${resultWord}", got ${JSON.stringify(entries)}`);
    }
  });

  scoped(/^the third verdict invokes the swarm halt once and the status file reads "([^"]+)"$/, (ctx, state) => {
    assert.equal(ctx.budgetResult.haltCount, 1, `expected exactly one halt, got ${ctx.budgetResult.haltCount}`);
    assert.equal(ctx.budgetResult.state, state, `expected status state "${state}", got ${ctx.budgetResult.state}`);
  });

  // ── Scenario 04 ───────────────────────────────────────────────────────────
  scoped(/^the supervisor runs one health check against the fixture root$/, (ctx) => {
    ctx.supervisorRun = spawnSync('bb', [SUPERVISOR_BB, ctx.root, '--check-once'], { encoding: 'utf8' });
  });

  scoped(/^it logs a skip naming the tmux-socket path and invokes no start owner$/, (ctx) => {
    const logPath = path.join(ctx.root, '.swarmforge', 'daemon', 'handoffd-supervisor.log');
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    assert.match(
      log,
      /skip tmux-socket absent; no swarm to supervise: .*tmux-socket/,
      `expected a tmux-socket-absent skip line, got:\n${log}`
    );
    const auditPath = path.join(ctx.root, '.swarmforge', 'daemon', 'daemon-start-audit.log');
    assert.equal(fs.existsSync(auditPath), false, 'expected no start-owner audit log (no start owner invoked)');
  });

  scoped(/^starting the daemon against the fixture root exits non-zero with one refusal line naming the tmux-socket path and no stack trace$/, (ctx) => {
    fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), '');
    const result = spawnSync('bb', [HANDOFFD_BB, ctx.root], {
      encoding: 'utf8',
      env: { ...process.env, SWARMFORGE_ALLOW_TMP_DAEMON: '1' },
    });
    assert.notEqual(result.status, 0, 'expected handoffd.bb to exit non-zero');
    const combined = `${result.stdout}${result.stderr}`;
    assert.match(combined, /refusing to start; tmux-socket absent at/);
    assert.doesNotMatch(combined, /Exception/, `expected no stack trace, got:\n${combined}`);
  });
}

module.exports = { registerSteps };
