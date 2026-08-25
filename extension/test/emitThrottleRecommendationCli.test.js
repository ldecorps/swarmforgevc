const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  parseArgs,
  throttleRecommendationPath,
  throttleChangeLogPath,
  computeThrottleRecommendation,
  emitThrottleRecommendation,
  main,
} = require('../out/tools/emit-throttle-recommendation');
const { persistReworkSignal } = require('../out/metrics/reworkObservatoryStore');

// BL-432 (epic BL-429 slice 3 - ACT): drives the REAL compiled
// diagnoseReworkSignal/classifyThrottleSeverity pipeline against a real
// persisted BL-430 signal fixture - never a fake diagnosis.

function mkTmp() {
  return mkTmpDir('sfvc-emit-throttle-recommendation-');
}

function writeSignal(targetPath, overrides = {}) {
  persistReworkSignal(targetPath, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-07-16T00:00:00Z',
    signal: { hasSample: true, sampleCount: 10, reworkRate: 0.5, baselineRate: 0.1, topRole: null, topTicketClass: null, ...overrides },
  });
}

function readChangeLogLines(targetPath) {
  try {
    return fs
      .readFileSync(throttleChangeLogPath(targetPath), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

// ── parseArgs ────────────────────────────────────────────────────────────

test('parseArgs returns the target repo path when present', () => {
  assert.deepEqual(parseArgs(['/target']), { targetRepoPath: '/target' });
});

test('parseArgs returns null when no arguments are given', () => {
  assert.equal(parseArgs([]), null);
});

// ── computeThrottleRecommendation (pure composition) ──────────────────────

test('computeThrottleRecommendation recommends nothing when no signal has been persisted yet', () => {
  const rec = computeThrottleRecommendation(mkTmp());
  assert.equal(rec.recommendedCap, null);
  assert.equal(rec.severity, null);
});

test('computeThrottleRecommendation recommends nothing when the signal is at/below baseline', () => {
  const targetPath = mkTmp();
  writeSignal(targetPath, { reworkRate: 0.1, baselineRate: 0.2 });
  const rec = computeThrottleRecommendation(targetPath);
  assert.equal(rec.recommendedCap, null);
});

test('computeThrottleRecommendation recommends nothing for a concentrated, escalate-only diagnosis - never auto-throttled', () => {
  const targetPath = mkTmp();
  writeSignal(targetPath, { reworkRate: 10, baselineRate: 0.1, topRole: 'hardener' });
  const rec = computeThrottleRecommendation(targetPath);
  assert.equal(rec.recommendedCap, null, 'a concentrated cause is escalate-only, never auto-applied');
});

// Acceptance scenario 01
test('computeThrottleRecommendation recommends cap one for a degraded (2x-4x baseline) safe-knob diagnosis', () => {
  const targetPath = mkTmp();
  writeSignal(targetPath, { reworkRate: 0.3, baselineRate: 0.1 });
  const rec = computeThrottleRecommendation(targetPath);
  assert.equal(rec.severity, 'degraded');
  assert.equal(rec.recommendedCap, 1);
});

// Acceptance scenario 02
test('computeThrottleRecommendation recommends cap zero for a severe (>4x baseline) safe-knob diagnosis', () => {
  const targetPath = mkTmp();
  writeSignal(targetPath, { reworkRate: 0.5, baselineRate: 0.1 });
  const rec = computeThrottleRecommendation(targetPath);
  assert.equal(rec.severity, 'severe');
  assert.equal(rec.recommendedCap, 0);
});

// ── emitThrottleRecommendation (persistence + change log) ────────────────

test('emitThrottleRecommendation persists the recommendation to disk', () => {
  const targetPath = mkTmp();
  writeSignal(targetPath, { reworkRate: 0.3, baselineRate: 0.1 });
  const rec = emitThrottleRecommendation(targetPath, Date.parse('2026-07-16T01:00:00Z'));
  const written = JSON.parse(fs.readFileSync(throttleRecommendationPath(targetPath), 'utf8'));
  assert.deepEqual(written, rec);
  assert.equal(written.recommendedCap, 1);
});

// Acceptance scenario 05
test('emitThrottleRecommendation logs a change when a throttle newly engages', () => {
  const targetPath = mkTmp();
  writeSignal(targetPath, { reworkRate: 0.3, baselineRate: 0.1 });
  emitThrottleRecommendation(targetPath, Date.parse('2026-07-16T01:00:00Z'));
  const changes = readChangeLogLines(targetPath);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].from, null);
  assert.equal(changes[0].to, 1);
  assert.match(changes[0].reason, /degraded/);
});

// Acceptance scenario 05 (deepen: degraded -> severe is ALSO a change)
test('emitThrottleRecommendation logs a change when the throttle deepens from degraded to severe', () => {
  const targetPath = mkTmp();
  writeSignal(targetPath, { reworkRate: 0.3, baselineRate: 0.1 });
  emitThrottleRecommendation(targetPath, Date.parse('2026-07-16T01:00:00Z'));

  writeSignal(targetPath, { reworkRate: 0.5, baselineRate: 0.1 });
  emitThrottleRecommendation(targetPath, Date.parse('2026-07-16T01:05:00Z'));

  const changes = readChangeLogLines(targetPath);
  assert.equal(changes.length, 2);
  assert.equal(changes[1].from, 1);
  assert.equal(changes[1].to, 0);
  assert.match(changes[1].reason, /severe/);
});

// Acceptance scenario 03: restore on recovery is a logged change too, and
// break-then-fix proves the read of the prior recommendation is
// load-bearing (removing/clearing the fixture, not merely a default).
test('emitThrottleRecommendation logs a change when the diagnosis clears and the throttle restores', () => {
  const targetPath = mkTmp();
  writeSignal(targetPath, { reworkRate: 0.3, baselineRate: 0.1 });
  emitThrottleRecommendation(targetPath, Date.parse('2026-07-16T01:00:00Z'));
  assert.equal(JSON.parse(fs.readFileSync(throttleRecommendationPath(targetPath), 'utf8')).recommendedCap, 1);

  writeSignal(targetPath, { reworkRate: 0.1, baselineRate: 0.1 }); // back at/below baseline
  const restored = emitThrottleRecommendation(targetPath, Date.parse('2026-07-16T02:00:00Z'));

  assert.equal(restored.recommendedCap, null);
  const changes = readChangeLogLines(targetPath);
  assert.equal(changes.length, 2);
  assert.equal(changes[1].from, 1);
  assert.equal(changes[1].to, null);
  assert.match(changes[1].reason, /cleared/);
});

test('emitThrottleRecommendation writes no change-log entry when the recommendation is unchanged (steady state, never spam)', () => {
  const targetPath = mkTmp();
  writeSignal(targetPath, { reworkRate: 0.3, baselineRate: 0.1 });
  emitThrottleRecommendation(targetPath, Date.parse('2026-07-16T01:00:00Z'));
  emitThrottleRecommendation(targetPath, Date.parse('2026-07-16T01:00:30Z'));

  assert.equal(readChangeLogLines(targetPath).length, 1, 'the second, unchanged call must not repeat the first log line');
});

test('emitThrottleRecommendation writes no change-log entry on a swarm that has never thrown a diagnosis (first call, both sides null)', () => {
  const targetPath = mkTmp();
  emitThrottleRecommendation(targetPath, Date.parse('2026-07-16T01:00:00Z'));

  assert.equal(readChangeLogLines(targetPath).length, 0);
});

// ── main() wiring ──────────────────────────────────────────────────────

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'emit-throttle-recommendation.js');

async function runCli(args) {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', CLI_PATH, ...args];
    process.exitCode = undefined;
    await main();
    return { exitCode: process.exitCode ?? 0, output: writes.join('') };
  } finally {
    process.stdout.write = originalWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
}

test('main() prints usage and exits non-zero when the target repo path is missing', async () => {
  const result = await runCli([]);
  assert.notEqual(result.exitCode, 0);
});

test('main() emits the recommendation and prints it to stdout', async () => {
  const targetPath = mkTmp();
  writeSignal(targetPath, { reworkRate: 0.3, baselineRate: 0.1 });
  const { exitCode, output } = await runCli([targetPath]);
  assert.equal(exitCode, 0);
  const printed = JSON.parse(output);
  assert.equal(printed.recommendedCap, 1);
  assert.ok(fs.existsSync(throttleRecommendationPath(targetPath)));
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and publishes the recommendation', () => {
  const targetPath = mkTmp();
  writeSignal(targetPath, { reworkRate: 0.5, baselineRate: 0.1 });
  const output = execFileSync('node', [CLI_PATH, targetPath], { encoding: 'utf8' });
  const printed = JSON.parse(output);
  assert.equal(printed.recommendedCap, 0);
  assert.ok(fs.existsSync(throttleRecommendationPath(targetPath)));
});
