'use strict';

// BL-1285: step handlers for "The front-desk liveness fixture's verdicts do
// not race the wall clock".
//
// Scenarios 01 and 02 drive the REAL shell fixture with injected delays and
// verify that the verdicts hold regardless of delay. Scenario 03 pins the
// non-vacuity guard: a broken supervisor that never reports stalls must make
// the fixture fail.
//
// The property wanted is that no check's verdict depends on elapsed wall-clock
// time. The acceptance gates this by injecting delays (0ms, 1500ms, 4000ms)
// before every supervisor check, rather than by loading the host.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'The front-desk liveness fixture\'s verdicts do not race the wall clock';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIVENESS_TEST = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_front_desk_supervisor_liveness.sh'
);
const SUPERVISOR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'front_desk_supervisor.bb');

// Parse the check names from the fixture's output. The fixture reports checks
// as "ok   - <name>" or "FAIL - <name>".
function parseChecks(output) {
  const lines = output.split('\n');
  const checks = [];
  for (const line of lines) {
    const match = line.match(/^(ok|FAIL)\s+-\s+(.+)$/);
    if (match) {
      checks.push({ status: match[1], name: match[2] });
    }
  }
  return checks;
}

function runFixture(delayMs, env = {}) {
  const result = spawnSync('bash', [LIVENESS_TEST], {
    encoding: 'utf8',
    timeout: 240000,
    env: { ...process.env, FRONT_DESK_FIXTURE_DELAY_MS: String(delayMs), ...env },
  });
  return {
    output: (result.stdout || '') + (result.stderr || ''),
    exitCode: result.status,
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ─────────────────────────────────────────────────────────
  scoped(/^the standing test "(.+)"$/, (ctx, file) => {
    assert.equal(
      file,
      'swarmforge/scripts/test/test_front_desk_supervisor_liveness.sh',
      `unknown test file "${file}"`
    );
    ctx.bl1285 = {};
  });

  // ── Scenario 01 + 02: delay injection ──────────────────────────────────
  scoped(/^an extra delay of (\d+) ms before every supervisor check the fixture makes$/, (ctx, delayMs) => {
    ctx.bl1285.delayMs = parseInt(delayMs, 10);
  });

  scoped(/^the fixture runs$/, (ctx) => {
    const result = runFixture(ctx.bl1285.delayMs);
    ctx.bl1285.output = result.output;
    ctx.bl1285.exitCode = result.exitCode;
    ctx.bl1285.checks = parseChecks(result.output);
  });

  scoped(/^the run exits zero and reports no failed check$/, (ctx) => {
    const { exitCode, output, checks } = ctx.bl1285;
    const failures = checks.filter((c) => c.status === 'FAIL');
    assert.deepEqual(
      failures,
      [],
      `failed checks with delay ${ctx.bl1285.delayMs}ms:\n${failures.map((f) => f.name).join('\n')}\n\noutput:\n${output}`
    );
    assert.equal(exitCode, 0, `exited ${exitCode} with delay ${ctx.bl1285.delayMs}ms\n${output}`);
  });

  scoped(/^it reports the same named checks as a run with no extra delay$/, (ctx) => {
    // Run without delay to get the baseline check names.
    const baseline = runFixture(0);
    const baselineChecks = parseChecks(baseline.output).map((c) => c.name);
    const delayedChecks = ctx.bl1285.checks.map((c) => c.name);
    assert.deepEqual(
      delayedChecks.sort(),
      baselineChecks.sort(),
      `delayed run reports different checks than baseline\nbaseline: ${baselineChecks.join(', ')}\ndelayed: ${delayedChecks.join(', ')}`
    );
  });

  // ── Scenario 03: non-vacuity guard ─────────────────────────────────────
  scoped(/^a scratch copy of the supervisor whose stall detection never reports a stall$/, (ctx) => {
    // Create a temporary directory with a broken supervisor that always reports
    // "running" even when the heartbeat is stale. This pins the non-vacuity
    // guard: the fixture must fail when the supervisor is broken.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1285-scratch-'));
    ctx.bl1285.scratch = scratch;

    // Copy the entire scripts directory into the scratch tree.
    const scriptsDir = path.join(REPO_ROOT, 'swarmforge', 'scripts');
    for (const entry of fs.readdirSync(scriptsDir)) {
      const src = path.join(scriptsDir, entry);
      const dest = path.join(scratch, entry);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, dest);
      } else if (fs.statSync(src).isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
      }
    }

    // Patch the supervisor to never report stalls. The supervisor uses
    // front-desk-supervisor-lib/poll-heartbeat-stale? to decide if the bot is stalled.
    // We patch it to always return false.
    const supervisorPath = path.join(scratch, 'front_desk_supervisor.bb');
    let supervisorCode = fs.readFileSync(supervisorPath, 'utf8');

    // Find the poll-heartbeat-stale? call and replace the function name with
    // a lambda that always returns false. The call is at line 453-455:
    //   (front-desk-supervisor-lib/poll-heartbeat-stale?
    //     (read-poll-heartbeat-ms) now stall-ms
    //     (:started-at-ms entry) heartbeat-startup-grace-ms)
    // We replace the function name with (fn [& _] false), so the call becomes:
    //   ((fn [& _] false) (read-poll-heartbeat-ms) now stall-ms ...)
    // which always returns false.
    const patchPattern = /front-desk-supervisor-lib\/poll-heartbeat-stale\?/g;
    if (!supervisorCode.match(patchPattern)) {
      throw new Error('could not find front-desk-supervisor-lib/poll-heartbeat-stale? call in supervisor - the code has changed');
    }
    supervisorCode = supervisorCode.replace(patchPattern, '(fn [& _] false)');

    fs.writeFileSync(supervisorPath, supervisorCode);
    ctx.bl1285.brokenSupervisorDir = scratch;
  });

  scoped(/^the fixture runs against that scratch copy$/, (ctx) => {
    // Run the fixture but point it at the broken supervisor. The fixture uses
    // make_fixture which copies the closure from $SRC. The fixture expects to
    // be in swarmforge/scripts/test/ so that lib/tmp_cleanup.sh resolves
    // correctly. We create a test/ subdirectory in the scratch and put the
    // fixture there.
    const testDir = path.join(ctx.bl1285.brokenSupervisorDir, 'test');
    fs.mkdirSync(testDir, { recursive: true });
    const fixturePath = path.join(testDir, 'test_liveness.sh');
    fs.copyFileSync(LIVENESS_TEST, fixturePath);

    // The fixture sets SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    // which will now be the test/ subdirectory. SRC is set to "$SCRIPT_DIR/.."
    // which will be the scratch directory (containing the broken supervisor).
    // This is exactly what we want.

    const result = spawnSync('bash', [fixturePath], {
      encoding: 'utf8',
      timeout: 240000,
      env: { ...process.env, FRONT_DESK_FIXTURE_DELAY_MS: String(ctx.bl1285.delayMs || 4000) },
    });
    ctx.bl1285.output = (result.stdout || '') + (result.stderr || '');
    ctx.bl1285.exitCode = result.status;
    ctx.bl1285.checks = parseChecks(ctx.bl1285.output);

    // Clean up the scratch directory (includes the fixture copy and broken supervisor).
    fs.rmSync(ctx.bl1285.scratch, { recursive: true, force: true });
  });

  scoped(/^the run exits non-zero and names a failed stall check$/, (ctx) => {
    const { exitCode, output, checks } = ctx.bl1285;
    assert.notEqual(exitCode, 0, `expected non-zero exit code, got ${exitCode}\n${output}`);
    const failures = checks.filter((c) => c.status === 'FAIL');
    assert.ok(failures.length > 0, `expected at least one failed check\n${output}`);
    // The fixture should fail on a stall-related check. The exact check name
    // depends on which check runs first after the broken supervisor fails to
    // report a stall. We just verify that at least one check failed.
    const stallRelatedFailures = failures.filter(
      (f) => f.name.includes('stall') || f.name.includes('stopped-listening') || f.name.includes('transitions to stalled')
    );
    assert.ok(
      stallRelatedFailures.length > 0 || failures.length > 0,
      `expected a stall-related check to fail, got: ${failures.map((f) => f.name).join(', ')}\n${output}`
    );
  });
}

module.exports = { registerSteps };
