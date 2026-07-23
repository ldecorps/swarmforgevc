const assert = require('node:assert/strict');
const {
  normalizeCommand,
  failureSignature,
  siblingDeferralNaturalKey,
  openBlockersForTicket,
  isRedundantSiblingDeferralWrite,
  decideDisposition,
} = require('../out/quality/siblingDeferral');

// BL-532: the pure sibling-deferral decision core - no filesystem, no clock.

function deferRecord(overrides = {}) {
  return {
    ticket: 'BL-477',
    blockedBy: 'BL-469',
    action: 'defer',
    failureClass: 'integration',
    check: 'npm run compile',
    commit: 'abc1234567',
    at: '2026-07-17T10:00:00.000Z',
    ...overrides,
  };
}

function clearRecord(overrides = {}) {
  return {
    ticket: 'BL-477',
    blockedBy: 'BL-469',
    action: 'clear',
    commit: 'def4567890',
    at: '2026-07-18T10:00:00.000Z',
    ...overrides,
  };
}

// ── failureSignature normalization ───────────────────────────────────────

test('normalizeCommand trims leading/trailing whitespace and collapses internal runs to one space', () => {
  assert.equal(normalizeCommand('  npm  run   compile  '), 'npm run compile');
});

test('two commands differing only in spacing share a failureSignature', () => {
  assert.equal(failureSignature('integration', 'npm run compile'), failureSignature('integration', '  npm   run compile'));
});

test('differing failure class alone produces a different failureSignature', () => {
  assert.notEqual(failureSignature('integration', 'npm run compile'), failureSignature('unit', 'npm run compile'));
});

// ── siblingDeferralNaturalKey ─────────────────────────────────────────────

test('siblingDeferralNaturalKey is the same for two defer records on the same day for the same ticket+blocker+class', () => {
  const a = deferRecord({ at: '2026-07-17T09:00:00.000Z' });
  const b = deferRecord({ at: '2026-07-17T23:59:00.000Z', commit: 'deadbeef00' });
  assert.equal(siblingDeferralNaturalKey(a), siblingDeferralNaturalKey(b));
});

test('siblingDeferralNaturalKey differs across ticket, blockedBy, action, date, or failure class', () => {
  const base = deferRecord();
  assert.notEqual(siblingDeferralNaturalKey(base), siblingDeferralNaturalKey(deferRecord({ ticket: 'BL-478' })));
  assert.notEqual(siblingDeferralNaturalKey(base), siblingDeferralNaturalKey(deferRecord({ blockedBy: 'BL-470' })));
  assert.notEqual(siblingDeferralNaturalKey(base), siblingDeferralNaturalKey(clearRecord({ at: base.at })));
  assert.notEqual(siblingDeferralNaturalKey(base), siblingDeferralNaturalKey(deferRecord({ at: '2026-07-18T09:00:00.000Z' })));
  assert.notEqual(siblingDeferralNaturalKey(base), siblingDeferralNaturalKey(deferRecord({ failureClass: 'unit' })));
});

test('siblingDeferralNaturalKey pins the exact `??` fallback for an absent failureClass to the empty string', () => {
  // A `notEqual`-only check (as above) can't tell an `?? ''` fallback from an
  // `?? "anything else"` fallback - a clear record's failureClass is absent
  // either way, and both fallbacks still differ from a defer record's real
  // class. Pin the literal string so the fallback value itself is load-bearing.
  const clear = clearRecord({ ticket: 'BL-477', blockedBy: 'BL-469', at: '2026-07-18T10:00:00.000Z' });
  assert.equal(siblingDeferralNaturalKey(clear), 'BL-477|BL-469|clear|2026-07-18|');
});

// ── isRedundantSiblingDeferralWrite (idempotency) ─────────────────────────

test('a second defer write for the same (ticket, blocker, date, class) is redundant', () => {
  const existing = [deferRecord()];
  const again = deferRecord({ commit: 'deadbeef00' });
  assert.equal(isRedundantSiblingDeferralWrite(existing, again), true);
});

test('a defer write is not redundant when nothing has been recorded for the pair yet', () => {
  assert.equal(isRedundantSiblingDeferralWrite([], deferRecord()), false);
});

// ── latest-record-wins ────────────────────────────────────────────────────

test('defer -> clear -> defer for one pair leaves it OPEN (latest-record-wins)', () => {
  const secondDefer = deferRecord({ at: '2026-07-19T10:00:00.000Z', commit: 'cafebabe00' });
  const records = [deferRecord(), clearRecord(), secondDefer];
  const open = openBlockersForTicket(records, 'BL-477');
  assert.equal(open.length, 1);
  assert.equal(open[0].blockedBy, 'BL-469');
  assert.equal(open[0].commit, 'cafebabe00');
});

test('a re-opening defer that shares its natural key with the FIRST defer is still appended (not deduped against full history)', () => {
  // Same day, same class as the original defer - the redundancy check must
  // compare against the pair's LATEST record (the clear), not the full log.
  const secondDefer = deferRecord({ commit: 'cafebabe00' });
  const existing = [deferRecord(), clearRecord()];
  assert.equal(isRedundantSiblingDeferralWrite(existing, secondDefer), false);
});

test('clearing removes the pair from the open-blocker set', () => {
  const records = [deferRecord(), clearRecord()];
  assert.deepEqual(openBlockersForTicket(records, 'BL-477'), []);
});

// ── open blockers: stable order + several blockers ────────────────────────

test('open blockers are returned in a stable order, by blocker ticket id', () => {
  // The chronologically-earlier record (BL-490) is alphabetically LATER than
  // the other (BL-469), so insertion/at order and blockedBy-sort order
  // disagree - a test where they coincide would pass even with the trailing
  // sort deleted entirely.
  const records = [
    deferRecord({ blockedBy: 'BL-490', at: '2026-07-17T10:00:00.000Z' }),
    deferRecord({ blockedBy: 'BL-469', at: '2026-07-17T10:00:01.000Z' }),
  ];
  const open = openBlockersForTicket(records, 'BL-477');
  assert.deepEqual(open.map((b) => b.blockedBy), ['BL-469', 'BL-490']);
});

test('latest-record-wins compares by chronological `at`, not by array/insertion order', () => {
  // Array order is the REVERSE of `at` order for the same pair - if the
  // latest-record-wins reduction stopped sorting by `at` and just kept
  // whichever record came last in the input array, this would pick the
  // earlier CLEAR instead of the later DEFER and wrongly read as closed.
  const laterDefer = deferRecord({ at: '2026-07-19T10:00:00.000Z', commit: 'cafebabe00' });
  const earlierClear = clearRecord({ at: '2026-07-18T10:00:00.000Z' });
  const open = openBlockersForTicket([laterDefer, earlierClear], 'BL-477');
  assert.equal(open.length, 1);
  assert.equal(open[0].commit, 'cafebabe00');
});

test('a defer record missing its failure class or check command is excluded from open blockers', () => {
  const missingFailureClass = openBlockersForTicket([deferRecord({ failureClass: undefined })], 'BL-477');
  assert.deepEqual(missingFailureClass, []);
  const missingCheck = openBlockersForTicket([deferRecord({ check: undefined })], 'BL-477');
  assert.deepEqual(missingCheck, []);
});

test('a clear record never opens a blocker, even if it carries a stray failure class and check', () => {
  const malformedClear = clearRecord({ failureClass: 'integration', check: 'npm run compile' });
  assert.deepEqual(openBlockersForTicket([malformedClear], 'BL-477'), []);
});

test('a ticket blocked by two siblings stays OPEN on both until each clears independently', () => {
  const records = [deferRecord({ blockedBy: 'BL-469' }), deferRecord({ blockedBy: 'BL-480', check: 'npm test' })];
  const open = openBlockersForTicket(records, 'BL-477');
  assert.deepEqual(open.map((b) => b.blockedBy), ['BL-469', 'BL-480']);

  const afterOneClear = [...records, clearRecord({ blockedBy: 'BL-469', at: '2026-07-18T10:00:00.000Z' })];
  const stillOpen = openBlockersForTicket(afterOneClear, 'BL-477');
  assert.deepEqual(stillOpen.map((b) => b.blockedBy), ['BL-480']);
});

test('openBlockersForTicket ignores records for a different ticket', () => {
  const records = [deferRecord({ ticket: 'BL-478' })];
  assert.deepEqual(openBlockersForTicket(records, 'BL-477'), []);
});

// ── decideDisposition ──────────────────────────────────────────────────────

test('no open blockers -> verify', () => {
  assert.deepEqual(decideDisposition([]), { kind: 'verify' });
});

test('open blocker(s) and no failing check of its own -> defer, naming every open blocker', () => {
  const openBlockers = [
    { blockedBy: 'BL-469', failureClass: 'integration', check: 'npm run compile', commit: 'abc1234567', at: '2026-07-17T10:00:00.000Z' },
  ];
  assert.deepEqual(decideDisposition(openBlockers, null), { kind: 'defer', blockers: openBlockers });
});

test('a failure whose signature matches an open blocker is still deferred, not bounced', () => {
  const openBlockers = [
    { blockedBy: 'BL-469', failureClass: 'integration', check: 'npm run compile', commit: 'abc1234567', at: '2026-07-17T10:00:00.000Z' },
  ];
  const disposition = decideDisposition(openBlockers, { failureClass: 'integration', check: '  npm   run compile  ' });
  assert.equal(disposition.kind, 'defer');
  assert.deepEqual(disposition.blockers, openBlockers);
});

test('a failure whose signature differs from every open blocker bounces for its own defect', () => {
  const openBlockers = [
    { blockedBy: 'BL-469', failureClass: 'integration', check: 'npm run compile', commit: 'abc1234567', at: '2026-07-17T10:00:00.000Z' },
  ];
  const disposition = decideDisposition(openBlockers, { failureClass: 'unit', check: 'npm test' });
  assert.deepEqual(disposition, { kind: 'bounce' });
});

// With TWO open blockers, a matching failure signature must defer naming
// ONLY the blocker it actually matches - never both, and never fall back to
// "any blocker present" once a filter is involved (hardener lesson: exercise
// a selector with 2+ candidates, never just one).

test('with two open blockers, a failure matching only one defers naming only that blocker', () => {
  const openBlockers = [
    { blockedBy: 'BL-469', failureClass: 'integration', check: 'npm run compile', commit: 'abc1234567', at: '2026-07-17T10:00:00.000Z' },
    { blockedBy: 'BL-480', failureClass: 'unit', check: 'npm test', commit: 'deadbeef00', at: '2026-07-17T10:00:01.000Z' },
  ];
  const disposition = decideDisposition(openBlockers, { failureClass: 'integration', check: 'npm run compile' });
  assert.deepEqual(disposition, { kind: 'defer', blockers: [openBlockers[0]] });
});

test('with two open blockers, a failure matching neither signature bounces (does not fall through to either blocker)', () => {
  const openBlockers = [
    { blockedBy: 'BL-469', failureClass: 'integration', check: 'npm run compile', commit: 'abc1234567', at: '2026-07-17T10:00:00.000Z' },
    { blockedBy: 'BL-480', failureClass: 'unit', check: 'npm test', commit: 'deadbeef00', at: '2026-07-17T10:00:01.000Z' },
  ];
  const disposition = decideDisposition(openBlockers, { failureClass: 'acceptance', check: 'npm run test:acceptance' });
  assert.deepEqual(disposition, { kind: 'bounce' });
});
