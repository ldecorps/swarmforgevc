'use strict';

// BL-1429: drives the REAL standing_red_register_cli.bb (BL-1428) through
// computeThrottleRecommendation/emitThrottleRecommendation - never a
// second TSV parser or a fake register report.
const { mkTmpDir } = require('./helpers/tmpDir');
const { writeStandingRedRegisterFixture } = require('./helpers/standingRedRegisterFixture');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  throttleChangeLogPath,
  computeThrottleRecommendation,
  emitThrottleRecommendation,
} = require('../out/tools/emit-throttle-recommendation');

function mkTmp() {
  return mkTmpDir('sfvc-emit-throttle-standing-red-');
}

function writeRegisterFixture(root, opts) {
  writeStandingRedRegisterFixture(root, { ...opts, filePrefix: 'bl1429-fixture' });
}

function writeThresholds(root, { maxCount, maxAgeDays } = {}) {
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  const lines = [];
  if (maxCount !== undefined) lines.push(`config standing_red_max_count ${maxCount}`);
  if (maxAgeDays !== undefined) lines.push(`config standing_red_max_age_days ${maxAgeDays}`);
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), lines.join('\n') + '\n');
}

test('BL-1429: no register file at all recommends nothing (degrades cleanly, never crashes)', () => {
  const root = mkTmp();
  const rec = computeThrottleRecommendation(root);
  assert.equal(rec.standingRed, null);
  assert.equal(rec.recommendedCap, null);
});

test('BL-1429: a register under every threshold recommends nothing', () => {
  const root = mkTmp();
  writeRegisterFixture(root, { count: 3, oldestAgeDays: 2 });
  const rec = computeThrottleRecommendation(root);
  assert.equal(rec.standingRed, null);
  assert.equal(rec.recommendedCap, null);
});

test('BL-1429: a register over the count threshold recommends cap 1, signal count', () => {
  const root = mkTmp();
  writeRegisterFixture(root, { count: 11, oldestAgeDays: 2 });
  const rec = computeThrottleRecommendation(root);
  assert.deepEqual(rec.standingRed, { recommendedCap: 1, signal: 'count' });
  assert.equal(rec.recommendedCap, 1);
});

test('BL-1429: a register with the oldest red past the age threshold recommends cap 1, signal age', () => {
  const root = mkTmp();
  writeRegisterFixture(root, { count: 3, oldestAgeDays: 8 });
  const rec = computeThrottleRecommendation(root);
  assert.deepEqual(rec.standingRed, { recommendedCap: 1, signal: 'age' });
  assert.equal(rec.recommendedCap, 1);
});

test('BL-1429: any unowned row recommends cap 1, signal unowned', () => {
  const root = mkTmp();
  writeRegisterFixture(root, { count: 3, oldestAgeDays: 2, unownedCount: 1 });
  const rec = computeThrottleRecommendation(root);
  assert.deepEqual(rec.standingRed, { recommendedCap: 1, signal: 'unowned' });
  assert.equal(rec.recommendedCap, 1);
});

test('BL-1429: thresholds are read from swarmforge.conf - a raised threshold clears a recommendation the default would have made', () => {
  const root = mkTmp();
  writeRegisterFixture(root, { count: 15, oldestAgeDays: 10 }); // crosses BOTH default thresholds
  writeThresholds(root, { maxCount: 30, maxAgeDays: 14 }); // but not these
  const rec = computeThrottleRecommendation(root);
  assert.equal(rec.standingRed, null);
  assert.equal(rec.recommendedCap, null);
});

test('BL-1429: the rework diagnosis and the register never raise each other - the LOWER of the two wins', () => {
  const root = mkTmp();
  writeRegisterFixture(root, { count: 11, oldestAgeDays: 2 }); // standing-red recommends 1
  const { persistReworkSignal } = require('../out/metrics/reworkObservatoryStore');
  persistReworkSignal(root, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-07-16T00:00:00Z',
    signal: { hasSample: true, sampleCount: 10, reworkRate: 0.5, baselineRate: 0.1, topRole: null, topTicketClass: null }, // severe -> 0
  });
  const rec = computeThrottleRecommendation(root);
  assert.equal(rec.recommendedCap, 0, 'expected the more restrictive (rework severe = 0) to win over standing-red (1)');
});

test('BL-1429: recovery withdraws the recommendation and logs the clearing, naming the signal that cleared', () => {
  const root = mkTmp();
  writeRegisterFixture(root, { count: 11, oldestAgeDays: 2 });
  emitThrottleRecommendation(root); // bakes the count-caused recommendation onto disk

  fs.rmSync(path.join(root, 'backlog', 'active'), { recursive: true, force: true });
  writeRegisterFixture(root, { count: 3, oldestAgeDays: 2 }); // back under every threshold
  const rec = emitThrottleRecommendation(root);

  assert.equal(rec.recommendedCap, null, 'expected the recommendation to be withdrawn');
  const lines = fs
    .readFileSync(throttleChangeLogPath(root), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const last = lines[lines.length - 1];
  assert.equal(last.from, 1);
  assert.equal(last.to, null);
  assert.match(last.reason, /red count/, `expected the clearing reason to name the red count, got: ${last.reason}`);
});

// Architect bounce (2026-09-05): a co-active but NON-binding standing-red
// signal must never be credited for a clearing whose true (binding) cause
// was the rework diagnosis - the clearing branch must run the same
// "which was actually binding" comparison the active branch already does,
// against the PRIOR tick's own caps, not merely check whether standingRed
// was present at all.
test('BL-1429 bounce: a clearing names the diagnosis that was actually binding, not a merely co-active signal', () => {
  const root = mkTmp();
  const { persistReworkSignal } = require('../out/metrics/reworkObservatoryStore');

  // Tick 1: severe rework (cap 0, binding) co-active with a standing-red
  // count signal (cap 1, present but never binding - the lower cap wins).
  writeRegisterFixture(root, { count: 11, oldestAgeDays: 2 });
  persistReworkSignal(root, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-07-16T00:00:00Z',
    signal: { hasSample: true, sampleCount: 10, reworkRate: 0.6, baselineRate: 0.1, topRole: null, topTicketClass: null }, // severe -> 0
  });
  const tick1 = emitThrottleRecommendation(root);
  assert.equal(tick1.recommendedCap, 0, 'expected the severe rework diagnosis (0) to win over the standing-red signal (1)');

  // Tick 2: both clear together.
  fs.rmSync(path.join(root, 'backlog', 'active'), { recursive: true, force: true });
  writeRegisterFixture(root, { count: 3, oldestAgeDays: 2 }); // back under every threshold
  persistReworkSignal(root, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-07-16T00:05:00Z',
    signal: { hasSample: true, sampleCount: 10, reworkRate: 0.1, baselineRate: 0.1, topRole: null, topTicketClass: null }, // healthy -> no verdict
  });
  const tick2 = emitThrottleRecommendation(root);
  assert.equal(tick2.recommendedCap, null, 'expected the recommendation to be fully withdrawn');

  const lines = fs
    .readFileSync(throttleChangeLogPath(root), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const last = lines[lines.length - 1];
  assert.equal(last.from, 0);
  assert.equal(last.to, null);
  assert.match(
    last.reason,
    /rework diagnosis cleared/,
    `expected the clearing reason to name the rework diagnosis (the actually-binding prior cause), not the merely co-active standing-red signal, got: ${last.reason}`
  );
  assert.doesNotMatch(last.reason, /red count/, `must not misattribute the clearing to the non-binding standing-red signal, got: ${last.reason}`);
});
