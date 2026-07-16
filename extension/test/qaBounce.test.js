const assert = require('node:assert/strict');
const {
  isKnownProducingRole,
  isKnownTicketType,
  isKnownFailureClass,
  qaBounceNaturalKey,
  hasQaBounceRecord,
  computeQaBounceTally,
} = require('../out/quality/qaBounce');

// BL-454: the pure QA-bounce core - closed-set validators, the idempotency
// natural key, and the tally aggregator. No filesystem, no clock.

function record(overrides = {}) {
  return {
    ticket: 'BL-340',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'abc1234567',
    at: '2026-07-14T10:00:00.000Z',
    ...overrides,
  };
}

// ── closed-set validators (qa-bounce-01/06 support) ─────────────────────

test('isKnownProducingRole accepts every role in the closed set', () => {
  for (const role of ['coder', 'cleaner', 'architect', 'hardender', 'documenter']) {
    assert.equal(isKnownProducingRole(role), true);
  }
});

test('isKnownProducingRole rejects a value outside the closed set (e.g. the real-world "hardener" spelling)', () => {
  assert.equal(isKnownProducingRole('hardener'), false);
  assert.equal(isKnownProducingRole('QA'), false);
  assert.equal(isKnownProducingRole(''), false);
});

test('isKnownTicketType accepts every type in the closed set', () => {
  for (const type of ['feature', 'bug', 'defect', 'chore', 'docs', 'enhancement', 'epic']) {
    assert.equal(isKnownTicketType(type), true);
  }
});

test('isKnownTicketType rejects a value outside the closed set', () => {
  assert.equal(isKnownTicketType('spike'), false);
});

test('isKnownFailureClass accepts every class in the closed set', () => {
  for (const cls of ['compile', 'unit', 'integration', 'acceptance', 'behavior']) {
    assert.equal(isKnownFailureClass(cls), true);
  }
});

test('isKnownFailureClass rejects a value outside the closed set (e.g. a real evidence file\'s own "scope")', () => {
  assert.equal(isKnownFailureClass('scope'), false);
});

// ── qaBounceNaturalKey / hasQaBounceRecord (qa-bounce-02 support) ───────

test('qaBounceNaturalKey is the same for two records on the same day for the same ticket+class', () => {
  const a = record({ at: '2026-07-14T09:00:00.000Z' });
  const b = record({ at: '2026-07-14T23:59:00.000Z' });
  assert.equal(qaBounceNaturalKey(a), qaBounceNaturalKey(b));
});

test('qaBounceNaturalKey differs across ticket, date, or failure class', () => {
  const base = record();
  assert.notEqual(qaBounceNaturalKey(base), qaBounceNaturalKey(record({ ticket: 'BL-341' })));
  assert.notEqual(qaBounceNaturalKey(base), qaBounceNaturalKey(record({ at: '2026-07-15T10:00:00.000Z' })));
  assert.notEqual(qaBounceNaturalKey(base), qaBounceNaturalKey(record({ failureClass: 'compile' })));
});

test('hasQaBounceRecord finds a natural-key match regardless of producingRole/ticketType/commit differing', () => {
  const existing = [record({ producingRole: 'cleaner', ticketType: 'bug', commit: 'deadbeef00' })];
  assert.equal(hasQaBounceRecord(existing, record()), true);
});

test('hasQaBounceRecord returns false when no existing record shares the natural key', () => {
  assert.equal(hasQaBounceRecord([record({ ticket: 'BL-999' })], record()), false);
});

// ── computeQaBounceTally (qa-bounce-05/06) ───────────────────────────────

test('the tally ranks roles by bounce count, most-bouncing first', () => {
  const records = [
    record({ ticket: 'BL-1', producingRole: 'coder' }),
    record({ ticket: 'BL-2', producingRole: 'coder' }),
    record({ ticket: 'BL-3', producingRole: 'architect' }),
  ];
  const tally = computeQaBounceTally(records);
  assert.deepEqual(tally.byRole, [
    { role: 'coder', count: 2 },
    { role: 'architect', count: 1 },
  ]);
  assert.equal(tally.total, 3);
});

test('the tally breaks bounces down by ticket type, independent of role ranking', () => {
  const records = [
    record({ ticket: 'BL-1', ticketType: 'bug' }),
    record({ ticket: 'BL-2', ticketType: 'bug' }),
    record({ ticket: 'BL-3', ticketType: 'feature' }),
  ];
  const tally = computeQaBounceTally(records);
  assert.deepEqual(tally.byTicketType, { bug: 2, feature: 1 });
});

test('ties in bounce count break alphabetically by role, for a deterministic ranking', () => {
  const records = [record({ ticket: 'BL-1', producingRole: 'documenter' }), record({ ticket: 'BL-2', producingRole: 'architect' })];
  const tally = computeQaBounceTally(records);
  assert.deepEqual(tally.byRole, [
    { role: 'architect', count: 1 },
    { role: 'documenter', count: 1 },
  ]);
});

test('an empty record set produces an empty tally, never a crash', () => {
  const tally = computeQaBounceTally([]);
  assert.deepEqual(tally, { byRole: [], byTicketType: {}, total: 0 });
});
