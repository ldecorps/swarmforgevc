const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'out', 'tools', 'record-run.js');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// os.homedir() (runLogPath's own resolution) honors the HOME env var on
// POSIX - an explicit allowlist env pointing HOME at a real, throwaway
// directory is what keeps this test from ever touching this box's own
// REAL ~/.swarmforge/runs.jsonl (the live production swarm's own run
// history).
function runCli(args, home) {
  const env = { PATH: process.env.PATH, HOME: home };
  const out = execFileSync('node', [CLI, ...args], { encoding: 'utf8', env });
  return JSON.parse(out);
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

test('BL-352: "start" appends a run entry naming the target and a running status', () => {
  const home = mkTmp('sfvc-record-run-home-');
  const target = mkTmp('sfvc-record-run-target-');
  const result = runCli(['start', target], home);
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

test('BL-352: the recorded run names the target it ran against', () => {
  const home = mkTmp('sfvc-record-run-home-');
  const target = mkTmp('sfvc-record-run-target-');
  runCli(['start', target], home);
  const runs = readRuns(home);
  assert.equal(runs[0].targetPath, target);
});

// ── run-history-headless-02 ────────────────────────────────────────────

test('BL-352: "stop" completes the most recent run for that target, not a new entry', () => {
  const home = mkTmp('sfvc-record-run-home-');
  const target = mkTmp('sfvc-record-run-target-');
  runCli(['start', target], home);
  const result = runCli(['stop', target], home);
  assert.equal(result.recorded, 'stop');
  const runs = readRuns(home);
  assert.equal(runs.length, 1, 'expected the SAME run entry updated, not a second one appended');
  assert.equal(runs[0].status, 'stopped');
  assert.ok(Date.parse(runs[0].completedAt), 'expected a real ISO completedAt timestamp');
});

test('BL-352: "stop" against a target with no prior run is a safe no-op (never crashes, never fabricates a run)', () => {
  const home = mkTmp('sfvc-record-run-home-');
  const target = mkTmp('sfvc-record-run-target-');
  const result = runCli(['stop', target], home);
  assert.equal(result.recorded, 'stop');
  assert.deepEqual(readRuns(home), []);
});

test('BL-352: "stop" only completes the run for the matching target, never a different one', () => {
  const home = mkTmp('sfvc-record-run-home-');
  const targetA = mkTmp('sfvc-record-run-target-a-');
  const targetB = mkTmp('sfvc-record-run-target-b-');
  runCli(['start', targetA], home);
  runCli(['start', targetB], home);
  runCli(['stop', targetA], home);
  const runs = readRuns(home);
  const runA = runs.find((r) => r.targetPath === targetA);
  const runB = runs.find((r) => r.targetPath === targetB);
  assert.equal(runA.status, 'stopped');
  assert.equal(runB.status, 'running');
});

// ── usage ─────────────────────────────────────────────────────────────

test('an unknown mode exits non-zero with a usage message, never a raw crash', () => {
  const home = mkTmp('sfvc-record-run-home-');
  assert.throws(() => {
    execFileSync('node', [CLI, 'bogus', '/some/target'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home } });
  }, /Usage: record-run\.js/);
});

test('a missing target path exits non-zero with a usage message', () => {
  const home = mkTmp('sfvc-record-run-home-');
  assert.throws(() => {
    execFileSync('node', [CLI, 'start'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home } });
  }, /Usage: record-run\.js/);
});
