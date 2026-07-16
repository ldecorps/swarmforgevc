const assert = require('node:assert/strict');
const {
  diagnoseReworkSignal,
  classifyRemediationDisposition,
  ABOVE_BASELINE_MULTIPLIER,
} = require('../out/metrics/reworkDiagnosis');

function signal(overrides) {
  return {
    hasSample: true,
    sampleCount: 10,
    reworkRate: 0.5,
    baselineRate: 0.2,
    topRole: null,
    topTicketClass: null,
    ...overrides,
  };
}

// ── diagnoseReworkSignal: when a verdict is (and isn't) produced ───────────

test('a rate meaningfully above baseline produces a verdict', () => {
  const verdict = diagnoseReworkSignal(signal({ reworkRate: 0.5, baselineRate: 0.2 }));
  assert.ok(verdict);
  assert.equal(verdict.reworkRate, 0.5);
  assert.equal(verdict.baselineRate, 0.2);
});

test('a rate at exactly the meaningfully-above threshold produces no verdict (boundary: > not >=)', () => {
  const verdict = diagnoseReworkSignal(signal({ reworkRate: 0.2 * ABOVE_BASELINE_MULTIPLIER, baselineRate: 0.2 }));
  assert.equal(verdict, null);
});

test('a rate just above the threshold produces a verdict (boundary pinned on both sides)', () => {
  const verdict = diagnoseReworkSignal(signal({ reworkRate: 0.2 * ABOVE_BASELINE_MULTIPLIER + 0.0001, baselineRate: 0.2 }));
  assert.ok(verdict);
});

test('a rate at baseline produces no verdict', () => {
  const verdict = diagnoseReworkSignal(signal({ reworkRate: 0.2, baselineRate: 0.2 }));
  assert.equal(verdict, null);
});

test('a rate below baseline produces no verdict', () => {
  const verdict = diagnoseReworkSignal(signal({ reworkRate: 0.1, baselineRate: 0.2 }));
  assert.equal(verdict, null);
});

test('no sample produces no verdict, never a crash on null rates', () => {
  const verdict = diagnoseReworkSignal(signal({ hasSample: false, reworkRate: null, baselineRate: null }));
  assert.equal(verdict, null);
});

test('hasSample false alone (valid, non-null rates) still produces no verdict - the !hasSample clause is load-bearing on its own, not only in combination with null rates', () => {
  const verdict = diagnoseReworkSignal(signal({ hasSample: false, reworkRate: 0.9, baselineRate: 0.1 }));
  assert.equal(verdict, null);
});

test('a null reworkRate alone (hasSample true, a valid baseline) still produces no verdict - the reworkRate === null clause is load-bearing on its own', () => {
  const verdict = diagnoseReworkSignal(signal({ hasSample: true, reworkRate: null, baselineRate: 0.2 }));
  assert.equal(verdict, null);
});

test('a null baseline (no baseline-period sample) produces no verdict - cannot be "meaningfully above" an unknown baseline', () => {
  const verdict = diagnoseReworkSignal(signal({ reworkRate: 0.9, baselineRate: null }));
  assert.equal(verdict, null);
});

test('a zero baseline treats any positive rate as meaningfully above it', () => {
  const verdict = diagnoseReworkSignal(signal({ reworkRate: 0.01, baselineRate: 0 }));
  assert.ok(verdict);
});

test('a zero baseline and a zero rate stays at/below - no verdict', () => {
  const verdict = diagnoseReworkSignal(signal({ reworkRate: 0, baselineRate: 0 }));
  assert.equal(verdict, null);
});

// ── likely cause naming (acceptance scenario 03) ───────────────────────────

test('the verdict names the likely cause from the attribution when both role and ticket-class concentrate', () => {
  const verdict = diagnoseReworkSignal(signal({ topRole: 'coder', topTicketClass: 'feature' }));
  assert.match(verdict.likelyCause, /coder/);
  assert.match(verdict.likelyCause, /feature/);
});

test('names only the role when the ticket-class has no dominant value', () => {
  const verdict = diagnoseReworkSignal(signal({ topRole: 'cleaner', topTicketClass: null }));
  assert.match(verdict.likelyCause, /cleaner/);
});

test('names only the ticket-class when the role has no dominant value', () => {
  const verdict = diagnoseReworkSignal(signal({ topRole: null, topTicketClass: 'chore' }));
  assert.match(verdict.likelyCause, /chore/);
});

test('with no identifiable concentration the cause says so explicitly, never a blank string', () => {
  const verdict = diagnoseReworkSignal(signal({ topRole: null, topTicketClass: null }));
  assert.equal(verdict.likelyCause, 'no single role or ticket-class dominates');
});

// ── recommended action + disposition (acceptance scenario 04) ─────────────

test('with no identifiable concentration the recommended action is the safe knob, auto-tunable', () => {
  const verdict = diagnoseReworkSignal(signal({ topRole: null, topTicketClass: null }));
  assert.equal(verdict.recommendedAction, 'lower the intake throttle');
  assert.equal(verdict.disposition, 'auto-tunable');
});

test('with an identifiable concentration the recommended action is a targeted escalation, escalate-only', () => {
  const verdict = diagnoseReworkSignal(signal({ topRole: 'hardener', topTicketClass: null }));
  assert.match(verdict.recommendedAction, /hardener/);
  assert.equal(verdict.disposition, 'escalate-only');
});

test('classifyRemediationDisposition marks the one sanctioned safe-knob string auto-tunable', () => {
  assert.equal(classifyRemediationDisposition('lower the intake throttle'), 'auto-tunable');
});

test('classifyRemediationDisposition marks every other remediation escalate-only, including near-miss text', () => {
  assert.equal(classifyRemediationDisposition('respawn a chronically-slow role'), 'escalate-only');
  assert.equal(classifyRemediationDisposition('change a routing rule'), 'escalate-only');
  assert.equal(classifyRemediationDisposition('Lower The Intake Throttle'), 'escalate-only');
  assert.equal(classifyRemediationDisposition(''), 'escalate-only');
});
