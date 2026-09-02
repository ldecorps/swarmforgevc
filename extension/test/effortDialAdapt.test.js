'use strict';

// BL-1317 Adapt tier: a seat's reasoning effort climbs from outcome signals
// and drops only after sustained clean work.
//
// BL-236 shipped Suggest-only and deferred Adapt. BL-1316 sets the
// CLAIM-TIME baseline from the held ticket's mutation_cost. Adapt moves
// around that baseline and never below it, so a hard ticket that keeps
// bouncing can climb without a human turning the dial, while an easy ticket
// cannot be dragged down under the floor its difficulty already bought.
//
// The asymmetry is the point (declared invariant 2): a climb is ONE notch per
// signal, a drop needs a whole clean streak. That is BL-545's descent-ladder
// hysteresis - cheap to escalate under evidence of under-thinking, expensive
// to de-escalate, because the cost of thinking too little is a bounce and the
// cost of thinking too much is only tokens.

const assert = require('node:assert/strict');
const {
  decideAdaptEffort,
  ADAPT_EFFORT_LADDER,
  ADAPT_DEFAULT_CLEAN_STREAK,
} = require('../out/tools/effortDialAdapt');

const base = {
  backendHasLever: true,
  baselineEffort: 'medium',
  priorEffort: 'medium',
  cleanStreak: 0,
  cleanStreakRequired: ADAPT_DEFAULT_CLEAN_STREAK,
};

// ── the ladder itself ────────────────────────────────────────────────────

test('BL-1317: the ladder is exactly low/medium/high, in that order', () => {
  assert.deepEqual(ADAPT_EFFORT_LADDER, ['low', 'medium', 'high']);
});

// ── climb ────────────────────────────────────────────────────────────────

test('BL-1317: a bounce climbs exactly one notch', () => {
  const d = decideAdaptEffort({ ...base, signal: 'bounce' });
  assert.equal(d.apply, true);
  assert.equal(d.effort, 'high');
});

test('BL-1317: a bounce from low climbs to medium, not straight to high', () => {
  const d = decideAdaptEffort({ ...base, baselineEffort: 'low', priorEffort: 'low', signal: 'bounce' });
  assert.equal(d.effort, 'medium');
});

test('BL-1317: a bounce at the top of the ladder stays there rather than overflowing', () => {
  const d = decideAdaptEffort({ ...base, priorEffort: 'high', signal: 'bounce' });
  assert.equal(d.effort, 'high');
  assert.equal(d.apply, false, 'nothing to write when the effort would not change');
});

// ── drop ─────────────────────────────────────────────────────────────────

test('BL-1317: a clean completion short of the streak changes nothing', () => {
  const d = decideAdaptEffort({
    ...base,
    priorEffort: 'high',
    signal: 'clean',
    cleanStreak: ADAPT_DEFAULT_CLEAN_STREAK - 1,
  });
  assert.equal(d.apply, false);
  assert.equal(d.effort, 'high');
});

test('BL-1317: meeting the clean streak drops exactly one notch', () => {
  const d = decideAdaptEffort({
    ...base,
    priorEffort: 'high',
    signal: 'clean',
    cleanStreak: ADAPT_DEFAULT_CLEAN_STREAK,
  });
  assert.equal(d.apply, true);
  assert.equal(d.effort, 'medium');
});

test('BL-1317: a drop never goes below the BL-1316 claim-time baseline', () => {
  const d = decideAdaptEffort({
    ...base,
    baselineEffort: 'medium',
    priorEffort: 'medium',
    signal: 'clean',
    cleanStreak: ADAPT_DEFAULT_CLEAN_STREAK,
  });
  assert.equal(d.apply, false, 'already at the baseline - there is nowhere to drop to');
  assert.equal(d.effort, 'medium');
});

test('BL-1317: a high-cost ticket keeps its high baseline however clean the streak', () => {
  const d = decideAdaptEffort({
    ...base,
    baselineEffort: 'high',
    priorEffort: 'high',
    signal: 'clean',
    cleanStreak: ADAPT_DEFAULT_CLEAN_STREAK * 5,
  });
  assert.equal(d.apply, false);
  assert.equal(d.effort, 'high');
});

// ── no lever (BL-1316 invariant 2, carried forward) ──────────────────────

test('BL-1317: a backend with no effort lever never decides to apply anything', () => {
  for (const signal of ['bounce', 'clean']) {
    const d = decideAdaptEffort({ ...base, backendHasLever: false, signal, cleanStreak: 99 });
    assert.equal(d.apply, false, `${signal} must not apply on a lever-less backend`);
    assert.equal(d.effort, undefined, 'and must not name an effort a lever-less backend cannot take');
  }
});

// ── fail-closed on unusable input ────────────────────────────────────────

test('BL-1317: an unknown prior effort is not guessed at', () => {
  const d = decideAdaptEffort({ ...base, priorEffort: 'turbo', signal: 'bounce' });
  assert.equal(d.apply, false);
});

test('BL-1317: an unknown signal changes nothing', () => {
  const d = decideAdaptEffort({ ...base, signal: 'shrug' });
  assert.equal(d.apply, false);
});

test('BL-1317: a missing baseline is treated as the prior effort, never as low', () => {
  // Treating an absent baseline as "low" would let a clean streak drag a
  // high-cost seat all the way down - the exact floor invariant 2 protects.
  const d = decideAdaptEffort({
    ...base,
    baselineEffort: undefined,
    priorEffort: 'high',
    signal: 'clean',
    cleanStreak: ADAPT_DEFAULT_CLEAN_STREAK,
  });
  assert.equal(d.apply, false);
});
