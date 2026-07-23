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
  const records = [
    deferRecord({ blockedBy: 'BL-480', at: '2026-07-17T10:00:01.000Z' }),
    deferRecord({ blockedBy: 'BL-469', at: '2026-07-17T10:00:00.000Z' }),
  ];
  const open = openBlockersForTicket(records, 'BL-477');
  assert.deepEqual(open.map((b) => b.blockedBy), ['BL-469', 'BL-480']);
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
