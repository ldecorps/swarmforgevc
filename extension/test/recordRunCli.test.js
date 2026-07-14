const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main, parseCliArgs } = require('../out/tools/record-run');

const CLI = path.join(__dirname, '..', 'out', 'tools', 'record-run.js');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// os.homedir() (runLogPath's own resolution) honors the HOME env var on
// POSIX - an explicit allowlist env pointing HOME at a real, throwaway
// directory is what keeps this test from ever touching this box's own
// REAL ~/.swarmforge/runs.jsonl (the live production swarm's own run
// history).
function runCliSubprocess(args, home) {
  const env = { PATH: process.env.PATH, HOME: home };
  const out = execFileSync('node', [CLI, ...args], { encoding: 'utf8', env });
  return JSON.parse(out);
}

// Runs the REAL main() in-process against a real HOME/argv, so in-process
// coverage and mutation tooling can see the branches a subprocess-only
// smoke test cannot (the engineering article's CLI main()-thin-wrapper
// rule). Same allowlist-env posture as runCliSubprocess above.
async function runCli(args, home) {
  const previousHome = process.env.HOME;
  const previousArgv = process.argv;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.env.HOME = home;
    process.argv = ['node', CLI, ...args];
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.env.HOME = previousHome;
    process.argv = previousArgv;
  }
  return writes.length > 0 ? JSON.parse(writes.join('')) : null;
}

function runsFile(home) {
  return path.join(home, '.swarmforge', 'runs.jsonl');
}

function readRuns(home) {
  try {
    return fs
      .readFileSync(runsFile(home), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

// ── run-history-headless-01 ────────────────────────────────────────────

test('BL-352: "start" appends a run entry naming the target and a running status', async () => {
  const home = mkTmp('sfvc-record-run-home-');
  const target = mkTmp('sfvc-record-run-target-');
  const result = await runCli(['start', target], home);
  assert.equal(result.recorded, 'start');
  const runs = readRuns(home);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].targetPath, target);
  assert.equal(runs[0].status, 'running');
  assert.equal(runs[0].completedAt, undefined);
  assert.match(runs[0].name, /^run-\d{8}-\d{4}$/);
  assert.ok(Date.parse(runs[0].startedAt), 'expected a real ISO startedAt timestamp');
});

// ── run-history-headless-03 ────────────────────────────────────────────

test('BL-352: the recorded run names the target it ran against', async () => {
  const home = mkTmp('sfvc-record-run-home-');
  const target = mkTmp('sfvc-record-run-target-');
  await runCli(['start', target], home);
  const runs = readRuns(home);
  assert.equal(runs[0].targetPath, target);
});

// ── run-history-headless-02 ────────────────────────────────────────────

test('BL-352: "stop" completes the most recent run for that target, not a new entry', async () => {
  const home = mkTmp('sfvc-record-run-home-');
  const target = mkTmp('sfvc-record-run-target-');
  await runCli(['start', target], home);
  const result = await runCli(['stop', target], home);
  assert.equal(result.recorded, 'stop');
  const runs = readRuns(home);
  assert.equal(runs.length, 1, 'expected the SAME run entry updated, not a second one appended');
  assert.equal(runs[0].status, 'stopped');
  assert.ok(Date.parse(runs[0].completedAt), 'expected a real ISO completedAt timestamp');
});

test('BL-352: "stop" against a target with no prior run is a safe no-op (never crashes, never fabricates a run)', async () => {
  const home = mkTmp('sfvc-record-run-home-');
  const target = mkTmp('sfvc-record-run-target-');
  const result = await runCli(['stop', target], home);
  assert.equal(result.recorded, 'stop');
  assert.deepEqual(readRuns(home), []);
});

test('BL-352: "stop" only completes the run for the matching target, never a different one', async () => {
  const home = mkTmp('sfvc-record-run-home-');
  const targetA = mkTmp('sfvc-record-run-target-a-');
  const targetB = mkTmp('sfvc-record-run-target-b-');
  await runCli(['start', targetA], home);
  await runCli(['start', targetB], home);
  await runCli(['stop', targetA], home);
  const runs = readRuns(home);
  const runA = runs.find((r) => r.targetPath === targetA);
  const runB = runs.find((r) => r.targetPath === targetB);
  assert.equal(runA.status, 'stopped');
  assert.equal(runB.status, 'running');
});

// ── parseCliArgs (in-process, so its own validation branches are covered) ──

test('parseCliArgs accepts a valid "start" invocation', () => {
  assert.deepEqual(parseCliArgs(['start', '/some/target']), { mode: 'start', targetPath: '/some/target' });
});

test('parseCliArgs accepts a valid "stop" invocation', () => {
  assert.deepEqual(parseCliArgs(['stop', '/some/target']), { mode: 'stop', targetPath: '/some/target' });
});

test('parseCliArgs rejects an unknown mode', () => {
  assert.equal(parseCliArgs(['bogus', '/some/target']), null);
});

test('parseCliArgs rejects a missing target path', () => {
  assert.equal(parseCliArgs(['start']), null);
});

test('parseCliArgs rejects no arguments at all', () => {
  assert.equal(parseCliArgs([]), null);
});

// ── usage (in-process - makeArgsGuardedMain sets process.exitCode = 1 and
//    writes usage to stderr on a guard failure, it never throws, so these
//    run through the real main() rather than a subprocess) ────────────────

test('an unknown mode exits non-zero with a usage message, never a raw crash', async () => {
  const home = mkTmp('sfvc-record-run-home-');
  const previousExitCode = process.exitCode;
  try {
    process.exitCode = undefined;
    const result = await runCli(['bogus', '/some/target'], home);
    assert.equal(result, null);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('a missing target path exits non-zero with a usage message', async () => {
  const home = mkTmp('sfvc-record-run-home-');
  const previousExitCode = process.exitCode;
  try {
    process.exitCode = undefined;
    const result = await runCli(['start'], home);
    assert.equal(result, null);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const home = mkTmp('sfvc-record-run-home-');
  const target = mkTmp('sfvc-record-run-target-');

  const result = runCliSubprocess(['start', target], home);

  assert.equal(result.recorded, 'start');
  const runs = readRuns(home);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].targetPath, target);
  assert.equal(runs[0].status, 'running');
});
