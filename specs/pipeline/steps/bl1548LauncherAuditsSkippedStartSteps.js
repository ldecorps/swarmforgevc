'use strict';

// BL-1548: step handlers for "The launcher audits a skipped start
// request". Scenarios 01/02 drive the REAL start_handoff_daemon.sh against
// a real fixture root - never a reimplementation of the launcher's own
// audit/skip ordering. Scenario 03 reuses the standing shell suite's own
// run/parse plumbing from bl1543DriftWiringLiveContractSteps.js (the SAME
// suite, test_handoffd_master_checkout_drift_wiring.sh, whose case 05 this
// ticket adds) rather than a second copy of it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LAUNCHER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'start_handoff_daemon.sh');
const bl1543 = require('./bl1543DriftWiringLiveContractSteps');

const FEATURE = 'BL-1548 The launcher audits a skipped start request';

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bl1548-'));
}

function daemonDir(root) {
  return path.join(root, '.swarmforge', 'daemon');
}

function auditLogPath(root) {
  return path.join(daemonDir(root), 'daemon-start-audit.log');
}

function readAuditLines(root) {
  const p = auditLogPath(root);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.length > 0);
}

function invocationLines(lines, root) {
  return lines.filter((l) => l.includes(`start_handoff_daemon invoked root=${root}`));
}

// A stub bb "daemon": writes its own pid to pidFileName under the fixture's
// daemon dir, then sleeps well past the launcher's PID_WAIT_ATTEMPTS window
// (default 60 * 0.1s = 6s) so the launcher's own kill -0 poll observes it
// alive, then exits zero - "inert" (per the feature's own Given wording),
// never touching anything else under the fixture.
function writeStubDaemonScript(root, scriptName, pidFileName) {
  const scriptPath = path.join(root, scriptName);
  const pidFile = path.join(daemonDir(root), pidFileName).replace(/\\/g, '\\\\');
  fs.writeFileSync(
    scriptPath,
    `(spit "${pidFile}" (str (.pid (java.lang.ProcessHandle/current))))\n(Thread/sleep 8000)\n`,
  );
  return scriptPath;
}

// Kills a stub daemon left running from a pid file, tolerating an already-
// exited process or a missing file - test cleanup, never assumed to race
// cleanly against the 8s sleep above.
function killStubIfAlive(root, pidFileName) {
  const pidFile = path.join(daemonDir(root), pidFileName);
  if (!fs.existsSync(pidFile)) return;
  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

function cleanupFixture(ctx) {
  if (!ctx.bl1548?.root) return;
  killStubIfAlive(ctx.bl1548.root, 'handoffd.pid');
  killStubIfAlive(ctx.bl1548.root, 'handoffd-supervisor.pid');
  fs.rmSync(ctx.bl1548.root, { recursive: true, force: true });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01: a skipped start request is ledgered and starts nothing ──
  scoped(/^a fixture root with a freshness stopped marker for "(.+)" already in place$/, (ctx, daemonName) => {
    const root = mkFixtureRoot();
    const stoppedDir = path.join(daemonDir(root), 'freshness-stopped');
    fs.mkdirSync(stoppedDir, { recursive: true });
    const marker = path.join(stoppedDir, `${daemonName}.stopped`);
    fs.writeFileSync(marker, '2026-09-16T00:00:00Z\n');
    ctx.bl1548 = { root, daemonName, marker };
  });

  // Shared by scenarios 01 and 02 (identical step text) - registering it
  // twice under the same feature would make the SECOND registration dead
  // (stepRegistry.resolve returns the first scoped match it finds), so the
  // stub env vars scenario 02's own Given left on ctx are added here only
  // when present; scenario 01's fixture never sets them.
  scoped(/^start_handoff_daemon\.sh is invoked against the fixture root with SWARMFORGE_SKIP_DAEMON "(.*)"$/, (ctx, skipValue) => {
    const { root, handoffdStub, supervisorStub } = ctx.bl1548;
    const env = { ...process.env, SWARMFORGE_SKIP_DAEMON: skipValue };
    if (handoffdStub) {
      env.HANDOFFD_BB = handoffdStub;
      env.HANDOFFD_SUPERVISOR_BB = supervisorStub;
      env.PID_WAIT_ATTEMPTS = '100';
    }
    ctx.bl1548.run = spawnSync('bash', [LAUNCHER, root], { encoding: 'utf8', env, timeout: 30000 });
  });

  scoped(/^the launcher exits zero and prints the skipping line$/, (ctx) => {
    const { run } = ctx.bl1548;
    assert.equal(run.status, 0, `launcher exited ${run.status}\nstdout: ${run.stdout}\nstderr: ${run.stderr}`);
    assert.match(run.stdout || '', /Skipping handoff daemon \(SWARMFORGE_SKIP_DAEMON=1\)\./);
  });

  scoped(/^the fixture's daemon-start-audit\.log carries exactly one invocation line naming the fixture root with SKIP_DAEMON reading "(.*)"$/, (ctx, skipValue) => {
    const { root } = ctx.bl1548;
    const lines = readAuditLines(root);
    const invocations = invocationLines(lines, root);
    assert.equal(invocations.length, 1, `expected exactly 1 invocation line, got ${invocations.length}:\n${lines.join('\n')}`);
    assert.match(invocations[0], new RegExp(`SKIP_DAEMON=${skipValue}(\\s|$)`), invocations[0]);
    ctx.bl1548.lines = lines;
    ctx.bl1548.invocationIndex = lines.indexOf(invocations[0]);
  });

  scoped(/^the freshness stopped marker for "(.+)" still exists$/, (ctx, daemonName) => {
    const marker = path.join(daemonDir(ctx.bl1548.root), 'freshness-stopped', `${daemonName}.stopped`);
    assert.ok(fs.existsSync(marker), `expected the stopped marker to survive at ${marker}`);
  });

  scoped(/^no handoffd pid file, no handoffd\.log and no process rooted in the fixture exist$/, (ctx) => {
    const { root } = ctx.bl1548;
    assert.ok(!fs.existsSync(path.join(daemonDir(root), 'handoffd.pid')), 'expected no handoffd.pid');
    assert.ok(!fs.existsSync(path.join(daemonDir(root), 'handoffd.log')), 'expected no handoffd.log');
    const probe = spawnSync('pgrep', ['-af', root], { encoding: 'utf8' });
    assert.notEqual(probe.status, 0, `a process still names the fixture root:\n${probe.stdout}`);
    cleanupFixture(ctx);
  });

  // ── Scenario 02: an unskipped request still ledgers first ────────────────
  scoped(/^a fixture root whose handoffd and supervisor scripts are inert stubs that exit zero$/, (ctx) => {
    const root = mkFixtureRoot();
    fs.mkdirSync(daemonDir(root), { recursive: true });
    const handoffdStub = writeStubDaemonScript(root, 'stub_handoffd.bb', 'handoffd.pid');
    const supervisorStub = writeStubDaemonScript(root, 'stub_supervisor.bb', 'handoffd-supervisor.pid');
    ctx.bl1548 = { root, handoffdStub, supervisorStub };
  });

  scoped(/^that invocation line precedes the operator env file line in the log$/, (ctx) => {
    const { lines, invocationIndex, run } = ctx.bl1548;
    const envLineIndex = lines.findIndex((l) => l.includes('operator env file'));
    assert.ok(envLineIndex >= 0, `no operator-env-file line found:\n${lines.join('\n')}\nlauncher stdout: ${run.stdout}\nstderr: ${run.stderr}`);
    assert.ok(invocationIndex >= 0, 'invocation line index was never recorded');
    assert.ok(invocationIndex < envLineIndex, `expected the invocation line (index ${invocationIndex}) before the operator-env line (index ${envLineIndex}):\n${lines.join('\n')}`);
    cleanupFixture(ctx);
  });

  // ── Scenario 03: reuses BL-1543's own run/parse plumbing ────────────────
  scoped(/^the wiring test "(.+)" which boots the real handoffd\.bb against a disposable repository$/, (ctx, file) => {
    assert.equal(file, bl1543.KNOWN_SUITE, `unknown suite example value "${file}"`);
    ctx.bl1548 = {};
  });

  scoped(/^the standing suite runs "(.+)"$/, (ctx, file) => {
    assert.equal(file, bl1543.KNOWN_SUITE, `unknown suite example value "${file}"`);
    if (!ctx.bl1548) ctx.bl1548 = {};
    if (!ctx.bl1548.run) ctx.bl1548.run = bl1543.runSuite();
  });

  scoped(/^the run exits zero and reports no failed check$/, (ctx) => {
    const { run } = ctx.bl1548;
    const failures = bl1543.outputOf(run).split('\n').filter((l) => l.startsWith('FAIL:'));
    assert.deepEqual(failures, [], `failed checks:\n${failures.join('\n')}\nfull output:\n${bl1543.outputOf(run)}`);
    assert.equal(run.status, 0, `suite exited ${run.status}\n${bl1543.outputOf(run)}`);
  });

  scoped(/^the run reports exactly (\d+) passed cases$/, (ctx, count) => {
    const expected = Number(count);
    const passes = bl1543.passLines(ctx.bl1548.run);
    assert.equal(passes.length, expected, `expected exactly ${expected} PASS lines, got ${passes.length}:\n${passes.join('\n')}`);
    ctx.bl1548.passes = passes;
  });

  scoped(/^case "(\d+)" reports the launcher audit log naming the fixture root under SKIP_DAEMON=1 with nothing started$/, (ctx, caseNum) => {
    const line = ctx.bl1548.passes.find((l) => l.startsWith(`PASS: ${caseNum}:`));
    assert.ok(line, `no PASS: ${caseNum}: line in:\n${ctx.bl1548.passes.join('\n')}`);
    assert.match(line, /daemon-start-audit\.log names/);
    assert.match(line, /SKIP_DAEMON=1/);
    assert.match(line, /nothing started/);
  });

  scoped(/^no process whose command line names a printed fixture root survives the run$/, (ctx) => {
    const { run } = ctx.bl1548;
    const roots = (run.stdout || '')
      .split('\n')
      .filter((l) => l.startsWith('fixture root: '))
      .map((l) => l.slice('fixture root: '.length).trim());
    assert.ok(roots.length >= 2, `expected at least 2 printed fixture roots, got: ${JSON.stringify(roots)}`);
    for (const root of roots) {
      const probe = spawnSync('pgrep', ['-af', root], { encoding: 'utf8' });
      assert.notEqual(probe.status, 0, `a process still names fixture root ${root}:\n${probe.stdout}`);
    }
  });
}

module.exports = { registerSteps };
