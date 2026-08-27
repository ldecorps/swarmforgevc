const assert = require('node:assert/strict');
const { computeEpicProgress, epicProgressText, epicOpeningText, epicAnnouncementKey } = require('../out/concierge/epicProgress');

// BL-341: an epic's slices are TICKETED (real backlog items) or
// REMAINING-UNTRACKED (declared only in the epic's own definition, no
// ticket yet) - the load-bearing requirement is that an epic whose every
// TICKETED slice is done must never be reported as finished while a
// remaining-untracked slice still exists.

function definition(overrides = {}) {
  return { id: 'dynamic-routing', title: 'Dynamic Routing', remainingSlices: [], ...overrides };
}

// ── computeEpicProgress (pure) ────────────────────────────────────────────

test('counts ticketed slices done vs total', () => {
  const progress = computeEpicProgress(definition(), [{ done: true }, { done: true }, { done: false }]);
  assert.equal(progress.ticketedTotal, 3);
  assert.equal(progress.ticketedDone, 2);
});

test('carries the definition\'s own remaining-untracked slices through unchanged', () => {
  const progress = computeEpicProgress(definition({ remainingSlices: ['warm-core/break-even tuning'] }), []);
  assert.deepEqual(progress.remainingUntracked, ['warm-core/break-even tuning']);
});

test('an epic with no slices at all reports 0 of 0', () => {
  const progress = computeEpicProgress(definition(), []);
  assert.equal(progress.ticketedTotal, 0);
  assert.equal(progress.ticketedDone, 0);
});

// ── epicProgressText (pure) ────────────────────────────────────────────────

test('states how many ticketed slices remain, as a count', () => {
  const progress = computeEpicProgress(definition(), [{ done: true }, { done: false }]);
  assert.equal(epicProgressText(progress), '1 of 2 ticketed slice(s) complete.');
});

test('names an untracked remaining slice explicitly, verbatim', () => {
  const progress = computeEpicProgress(definition({ remainingSlices: ['warm-core/break-even tuning'] }), [{ done: true }]);
  const text = epicProgressText(progress);
  assert.match(text, /warm-core\/break-even tuning/);
});

// BL-341's own "load-bearing requirement": every ticketed slice done must
// NEVER be reported as the epic being finished while an untracked slice
// still exists - the exact gap that hid all three of the human's real
// epics behind a false "done".
test('every ticketed slice done is NOT reported as epic-complete while an untracked remaining slice exists', () => {
  const progress = computeEpicProgress(definition({ remainingSlices: ['warm-core/break-even tuning'] }), [{ done: true }, { done: true }]);
  const text = epicProgressText(progress);
  assert.equal(text.includes('Epic complete'), false, `must not claim completion while work remains, got: ${text}`);
  assert.match(text, /warm-core\/break-even tuning/);
});

test('every ticketed slice done AND no untracked remaining slice is reported as epic-complete', () => {
  const progress = computeEpicProgress(definition({ remainingSlices: [] }), [{ done: true }, { done: true }]);
  const text = epicProgressText(progress);
  assert.match(text, /Epic complete/);
});

test('an incomplete epic with no untracked remaining slice states only the count, no false completion claim', () => {
  const progress = computeEpicProgress(definition({ remainingSlices: [] }), [{ done: true }, { done: false }]);
  const text = epicProgressText(progress);
  assert.equal(text.includes('Epic complete'), false);
});

// ── epicOpeningText (pure) ─────────────────────────────────────────────────

test('the epic topic opening names the epic by its title', () => {
  assert.equal(epicOpeningText('Dynamic Routing'), 'Epic: Dynamic Routing');
});

// ── epicAnnouncementKey (pure, BL-394) ─────────────────────────────────────

test('the same epic id and text always produce the same key', () => {
  assert.equal(
    epicAnnouncementKey('dynamic-routing', '1 of 2 ticketed slice(s) complete.'),
    epicAnnouncementKey('dynamic-routing', '1 of 2 ticketed slice(s) complete.')
  );
});

test('a changed text produces a different key for the same epic', () => {
  const before = epicAnnouncementKey('dynamic-routing', '1 of 2 ticketed slice(s) complete.');
  const after = epicAnnouncementKey('dynamic-routing', '2 of 2 ticketed slice(s) complete.');
  assert.notEqual(before, after);
});

test('the same text produces a different key for a different epic', () => {
  const routing = epicAnnouncementKey('dynamic-routing', 'Epic: Dynamic Routing');
  const benchmarking = epicAnnouncementKey('role-benchmarking', 'Epic: Dynamic Routing');
  assert.notEqual(routing, benchmarking);
});
