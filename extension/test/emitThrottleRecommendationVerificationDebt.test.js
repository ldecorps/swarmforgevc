'use strict';

// BL-1784: drives the REAL verification_debt_ledger_read.bb (BL-1782)
// through computeThrottleRecommendation/emitThrottleRecommendation - never
// a fake ledger report, mirroring emitThrottleRecommendationStandingRed.test.js's
// own posture for the standing-red register (BL-1429).
const { mkTmpDir } = require('./helpers/tmpDir');
const { writeVerificationDebtLedgerFixture, mintCategoryOwner, writeThreshold } = require('./helpers/verificationDebtLedgerFixture');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  throttleChangeLogPath,
  computeThrottleRecommendation,
  emitThrottleRecommendation,
} = require('../out/tools/emit-throttle-recommendation');

function mkTmp() {
  return mkTmpDir('sfvc-emit-throttle-verification-debt-');
}

function readLastChangeLogEntry(root) {
  const lines = fs
    .readFileSync(throttleChangeLogPath(root), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return lines[lines.length - 1];
}

test('BL-1784: no ledger at all recommends nothing (degrades cleanly, never crashes)', () => {
  const root = mkTmp();
  const rec = computeThrottleRecommendation(root);
  assert.equal(rec.verificationDebt, null);
  assert.equal(rec.recommendedCap, null);
});

test('BL-1784: an unowned category over its threshold recommends cap 1, naming it', () => {
  const root = mkTmp();
  writeThreshold(root, 1);
  writeVerificationDebtLedgerFixture(root, { rows: [{ category: 'land-path-ownership', ticket: 'BL-9801' }] });
  const rec = computeThrottleRecommendation(root);
  assert.deepEqual(rec.verificationDebt, { recommendedCap: 1, categories: ['land-path-ownership'] });
  assert.equal(rec.recommendedCap, 1);
});

test('BL-1784: an owned category under threshold recommends nothing', () => {
  const root = mkTmp();
  writeThreshold(root, 1);
  writeVerificationDebtLedgerFixture(root, { rows: [{ category: 'land-path-ownership', ticket: 'BL-9801' }] });
  mintCategoryOwner(root, { category: 'land-path-ownership', ticket: 'BL-9700' });
  const rec = computeThrottleRecommendation(root);
  assert.equal(rec.verificationDebt, null);
  assert.equal(rec.recommendedCap, null);
});

test('BL-1784: the rework diagnosis and the ledger never raise each other - the LOWER of the two wins', () => {
  const root = mkTmp();
  writeThreshold(root, 1);
  writeVerificationDebtLedgerFixture(root, { rows: [{ category: 'land-path-ownership', ticket: 'BL-9801' }] }); // verification-debt recommends 1
  const { persistReworkSignal } = require('../out/metrics/reworkObservatoryStore');
  persistReworkSignal(root, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-07-16T00:00:00Z',
    signal: { hasSample: true, sampleCount: 10, reworkRate: 0.5, baselineRate: 0.1, topRole: null, topTicketClass: null }, // severe -> 0
  });
  const rec = computeThrottleRecommendation(root);
  assert.equal(rec.recommendedCap, 0, 'expected the more restrictive (rework severe = 0) to win over the verification-debt signal (1)');
});

test('BL-1784: recovery withdraws the recommendation and logs the clearing, naming the category that cleared', () => {
  const root = mkTmp();
  writeThreshold(root, 1);
  writeVerificationDebtLedgerFixture(root, { rows: [{ category: 'land-path-ownership', ticket: 'BL-9801' }] });
  emitThrottleRecommendation(root); // bakes the verification-debt-caused recommendation onto disk

  mintCategoryOwner(root, { category: 'land-path-ownership', ticket: 'BL-9700' }); // minted - no longer unowned
  const rec = emitThrottleRecommendation(root);

  assert.equal(rec.recommendedCap, null, 'expected the recommendation to be withdrawn');
  const last = readLastChangeLogEntry(root);
  assert.equal(last.from, 1);
  assert.equal(last.to, null);
  assert.match(last.reason, /verification-debt category land-path-ownership/, `expected the clearing reason to name the category, got: ${last.reason}`);
});

// Architect-bounce rule (BL-1429), extended to the third signal: a clearing
// must credit whichever signal was ACTUALLY binding in the prior tick, never
// a merely co-active one.
test('BL-1784: a clearing names the diagnosis that was actually binding, not a merely co-active verification-debt signal', () => {
  const root = mkTmp();
  writeThreshold(root, 1);
  const { persistReworkSignal } = require('../out/metrics/reworkObservatoryStore');

  // Tick 1: severe rework (cap 0, binding) co-active with an unowned
  // verification-debt category (cap 1, present but never binding).
  writeVerificationDebtLedgerFixture(root, { rows: [{ category: 'land-path-ownership', ticket: 'BL-9801' }] });
  persistReworkSignal(root, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-07-16T00:00:00Z',
    signal: { hasSample: true, sampleCount: 10, reworkRate: 0.6, baselineRate: 0.1, topRole: null, topTicketClass: null }, // severe -> 0
  });
  const tick1 = emitThrottleRecommendation(root);
  assert.equal(tick1.recommendedCap, 0, 'expected the severe rework diagnosis (0) to win over the verification-debt signal (1)');

  // Tick 2: both clear together.
  mintCategoryOwner(root, { category: 'land-path-ownership', ticket: 'BL-9700' });
  persistReworkSignal(root, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-07-16T00:05:00Z',
    signal: { hasSample: true, sampleCount: 10, reworkRate: 0.1, baselineRate: 0.1, topRole: null, topTicketClass: null }, // healthy -> no verdict
  });
  const tick2 = emitThrottleRecommendation(root);
  assert.equal(tick2.recommendedCap, null, 'expected the recommendation to be fully withdrawn');

  const last = readLastChangeLogEntry(root);
  assert.equal(last.from, 0);
  assert.equal(last.to, null);
  assert.match(
    last.reason,
    /rework diagnosis cleared/,
    `expected the clearing reason to name the rework diagnosis (the actually-binding prior cause), not the merely co-active verification-debt signal, got: ${last.reason}`
  );
  assert.doesNotMatch(
    last.reason,
    /verification-debt/,
    `must not misattribute the clearing to the non-binding verification-debt signal, got: ${last.reason}`
  );
});

test('BL-1784: a standing-red signal and a verification-debt signal co-active at the same cap credit standing-red (fixed tie order)', () => {
  const root = mkTmp();
  writeThreshold(root, 1);
  writeVerificationDebtLedgerFixture(root, { rows: [{ category: 'land-path-ownership', ticket: 'BL-9801' }] });
  const { writeStandingRedRegisterFixture } = require('./helpers/standingRedRegisterFixture');
  writeStandingRedRegisterFixture(root, { count: 11, oldestAgeDays: 2, filePrefix: 'bl1784-tie-fixture' });

  const rec = computeThrottleRecommendation(root);
  assert.equal(rec.recommendedCap, 1);
  assert.deepEqual(rec.standingRed, { recommendedCap: 1, signal: 'count' });
  assert.deepEqual(rec.verificationDebt, { recommendedCap: 1, categories: ['land-path-ownership'] });
});

// Hardener pass: bindingNonReworkSignal's SECOND branch (verificationDebt,
// reached only when standingRed is absent) ties against a DEGRADED rework
// diagnosis - the only combination where the shared signalBindsAtOrBelow
// helper's own `<=` (never `<`) actually matters: both caps resolve to 1
// either way, so only the NAMED cause can tell a `<=` implementation apart
// from a `<` one. No standingRed here, so this exercises verificationDebt's
// own branch specifically (not merely the shared helper via standingRed's
// branch, which throttleHoldEpisode.test.js's own tie test already covers).
test('BL-1784: a verification-debt signal tied with a degraded rework diagnosis credits the verification-debt signal, not "a degraded rework diagnosis" (the <= tie-break)', () => {
  const root = mkTmp();
  writeThreshold(root, 1);
  writeVerificationDebtLedgerFixture(root, { rows: [{ category: 'land-path-ownership', ticket: 'BL-9801' }] });
  const { persistReworkSignal } = require('../out/metrics/reworkObservatoryStore');
  persistReworkSignal(root, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-07-16T00:00:00Z',
    signal: { hasSample: true, sampleCount: 10, reworkRate: 0.3, baselineRate: 0.1, topRole: null, topTicketClass: null }, // degraded -> 1
  });

  const rec = emitThrottleRecommendation(root);
  assert.equal(rec.severity, 'degraded');
  assert.equal(rec.recommendedCap, 1, 'both signals resolve to the same cap - only the naming can tell <= apart from <');
  assert.equal(rec.standingRed, null, 'standingRed must be absent so this exercises bindingNonReworkSignal\'s verificationDebt branch, not its standingRed one');

  const last = readLastChangeLogEntry(root);
  assert.match(
    last.reason,
    /verification-debt category land-path-ownership/,
    `expected the tie to credit the verification-debt signal, got: ${last.reason}`
  );
  assert.doesNotMatch(last.reason, /degraded rework diagnosis/, `must not fall back to the generic rework phrase on a tie, got: ${last.reason}`);
});
