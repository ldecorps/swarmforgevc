'use strict';

const assert = require('node:assert/strict');
const { estimateEpicEta, childWeight, childBlocked } = require('../out/metrics/epicEta');

// BL-591: the pure epic-ETA estimator. Fixture clock throughout - no git,
// no bridge, no real time.

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const WINDOW = 28 * DAY;

function steadyCompletions(perDay = 2) {
  const events = [];
  for (let d = 0; d < 28; d++) {
    for (let k = 0; k < perDay; k++) {
      events.push(NOW - d * DAY - (k + 1) * 1000);
    }
  }
  return events;
}

function baseInput(overrides = {}) {
  return {
    children: [{ mutationCost: 'medium' }, { mutationCost: 'medium' }],
    completionsMs: steadyCompletions(),
    nowMs: NOW,
    windowMs: WINDOW,
    packLabel: 'full-forge',
    ...overrides,
  };
}

test('a buildable epic on a steady pace gets a RANGE: low strictly below high, finite, never a point', () => {
  const eta = estimateEpicEta(baseInput());
  assert.equal(eta.kind, 'ranged');
  assert.ok(eta.lowDays < eta.highDays, `expected low < high, got ${eta.lowDays}..${eta.highDays}`);
  assert.ok(Number.isFinite(eta.lowDays) && Number.isFinite(eta.highDays));
});

test('the pace assumption names the pack and the trailing window', () => {
  const eta = estimateEpicEta(baseInput());
  assert.ok(eta.paceAssumption.includes('full-forge'), eta.paceAssumption);
  assert.ok(eta.paceAssumption.includes('28d'), eta.paceAssumption);
});

test('no open children resolves to complete - no range, no pace assumption', () => {
  const eta = estimateEpicEta(baseInput({ children: [] }));
  assert.deepEqual(eta, { kind: 'complete' });
});

test('a done child and the epic tracker itself contribute zero weight', () => {
  const withNoise = estimateEpicEta(
    baseInput({
      children: [
        { mutationCost: 'medium' },
        { mutationCost: 'medium' },
        { mutationCost: 'high', done: true },
        { mutationCost: 'high', type: 'epic' },
      ],
    })
  );
  const without = estimateEpicEta(baseInput());
  assert.deepEqual(withNoise, without);
});

test('a blocked child never contributes to the duration: removing it leaves the range unchanged', () => {
  const withBlocked = estimateEpicEta(
    baseInput({
      children: [{ mutationCost: 'medium' }, { mutationCost: 'medium' }, { mutationCost: 'high', blockUntil: ['GH-22'] }],
    })
  );
  const without = estimateEpicEta(baseInput());
  assert.equal(withBlocked.kind, 'ranged');
  assert.equal(withBlocked.blockedCount, 1);
  assert.equal(withBlocked.lowDays, without.lowDays);
  assert.equal(withBlocked.highDays, without.highDays);
});

test('every not-startable child state counts as blocked', () => {
  assert.ok(childBlocked({ held: true }));
  assert.ok(childBlocked({ statusText: 'needs_design' }));
  assert.ok(childBlocked({ statusText: 'blocked' }));
  assert.ok(childBlocked({ blockUntil: ['GH-22'] }));
  assert.ok(childBlocked({ promotionBlockers: ['awaiting ruling'] }));
  assert.ok(!childBlocked({ mutationCost: 'high' }));
  assert.ok(!childBlocked({ blockUntil: [] }));
});

test('an all-blocked epic shows a blocked state naming why in a word - no duration', () => {
  const eta = estimateEpicEta(
    baseInput({ children: [{ blockUntil: ['GH-22'] }, { statusText: 'needs_design' }] })
  );
  assert.equal(eta.kind, 'blocked');
  assert.equal(eta.blockedCount, 2);
  assert.ok(typeof eta.reason === 'string' && eta.reason.length > 0 && !eta.reason.includes(' '));
});

test('weights are strictly monotonic low < medium < high, absent cost counts medium', () => {
  assert.ok(childWeight({ mutationCost: 'low' }) < childWeight({ mutationCost: 'medium' }));
  assert.ok(childWeight({ mutationCost: 'medium' }) < childWeight({ mutationCost: 'high' }));
  assert.equal(childWeight({}), childWeight({ mutationCost: 'medium' }));
});

test('zero completions in the window degrades to no-recent-pace, never NaN/Infinity', () => {
  const eta = estimateEpicEta(baseInput({ completionsMs: [] }));
  assert.equal(eta.kind, 'no-recent-pace');
  assert.ok(!JSON.stringify(eta).match(/NaN|Infinity/));
});

test('confidence degrades strictly as blocked weight dominates, naming the reason in a word', () => {
  const allBuildable = estimateEpicEta(baseInput());
  const mostlyBlocked = estimateEpicEta(
    baseInput({
      children: [
        { mutationCost: 'low' },
        { mutationCost: 'high', blockUntil: ['GH-22'] },
        { mutationCost: 'high', held: true },
      ],
    })
  );
  const rank = { low: 0, medium: 1, high: 2 };
  assert.equal(allBuildable.kind, 'ranged');
  assert.equal(mostlyBlocked.kind, 'ranged');
  assert.ok(
    rank[mostlyBlocked.confidence] < rank[allBuildable.confidence],
    `expected strictly lower confidence, got ${mostlyBlocked.confidence} vs ${allBuildable.confidence}`
  );
  assert.equal(mostlyBlocked.confidenceReason, 'blocked');
});
