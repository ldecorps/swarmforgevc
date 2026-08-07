const assert = require('node:assert/strict');
const {
  KNOWN_LEAN_LEDGER_SOURCES,
  KNOWN_LEAN_LEDGER_EVENT_TYPES,
  KNOWN_LEAN_LEDGER_DATA_KEYS,
  isKnownLeanLedgerSource,
  isKnownLeanLedgerEventType,
  hasLeanLedgerEventShape,
  leanLedgerEventNaturalKey,
  hasLeanLedgerEvent,
  foldLeanLedgerSnapshot,
} = require('../out/quality/leanLedger');

// BL-819: pure core for the coordinator-owned ticket lifecycle ledger.

function dwellEvent(overrides = {}) {
  return {
    ticket: 'BL-819',
    type: 'stage_transition',
    source: 'stage-dwell',
    at: '2026-08-07T10:00:00.000Z',
    role: 'coder',
    data: { queueWaitMs: 1000, processingMs: 5000 },
    ...overrides,
  };
}

function bounceEvent(overrides = {}) {
  return {
    ticket: 'BL-819',
    type: 'bounce',
    source: 'bounce-store',
    at: '2026-08-07T11:00:00.000Z',
    data: { by: 'architect', blamedRole: 'coder', failureClass: 'behavior', commit: 'abc1234567', evidence: 'backlog/evidence/BL-819.md' },
    ...overrides,
  };
}

// ── closed-set vocabularies ────────────────────────────────────────────

test('KNOWN_LEAN_LEDGER_SOURCES names exactly the five instruments this slice composes from', () => {
  assert.deepEqual([...KNOWN_LEAN_LEDGER_SOURCES].sort(), ['backlog-close', 'bounce-store', 'chaser-telemetry', 'stage-dwell', 'routing-skip-log'].sort());
});

test('isKnownLeanLedgerSource/isKnownLeanLedgerEventType are case-sensitive closed sets', () => {
  assert.equal(isKnownLeanLedgerSource('stage-dwell'), true);
  assert.equal(isKnownLeanLedgerSource('Stage-Dwell'), false);
  assert.equal(isKnownLeanLedgerSource('llm-narrated'), false);
  assert.equal(isKnownLeanLedgerEventType('bounce'), true);
  assert.equal(isKnownLeanLedgerEventType('bogus'), false);
});

// ── shape / traceability guard (invariant 2's executable half) ─────────

test('a well-formed event of every known source passes shape validation', () => {
  for (const source of KNOWN_LEAN_LEDGER_SOURCES) {
    const data = {};
    for (const key of KNOWN_LEAN_LEDGER_DATA_KEYS[source]) {
      data[key] = 'x';
    }
    const event = { ticket: 'BL-1', type: KNOWN_LEAN_LEDGER_EVENT_TYPES[0], source, at: '2026-08-07T00:00:00.000Z', data };
    assert.equal(hasLeanLedgerEventShape(event), true, `source ${source} should be valid`);
  }
});

test('a data key outside its source\'s closed list is rejected - the case a computed/invented field would trip', () => {
  const event = dwellEvent({ data: { queueWaitMs: 1000, processingMs: 5000, llmSummary: 'looks slow' } });
  assert.equal(hasLeanLedgerEventShape(event), false);
});

test('an unknown source or type is rejected outright', () => {
  assert.equal(hasLeanLedgerEventShape(dwellEvent({ source: 'vibes' })), false);
  assert.equal(hasLeanLedgerEventShape(dwellEvent({ type: 'narration' })), false);
});

test('a missing required base field is rejected', () => {
  const event = dwellEvent();
  delete event.ticket;
  assert.equal(hasLeanLedgerEventShape(event), false);
});

// ── idempotency natural key (invariant 1) ───────────────────────────────

test('two identical events (same underlying instrument facts) share a natural key', () => {
  assert.equal(leanLedgerEventNaturalKey(dwellEvent()), leanLedgerEventNaturalKey(dwellEvent()));
});

test('events differing only in data values get different natural keys', () => {
  const a = dwellEvent({ data: { queueWaitMs: 1000, processingMs: 5000 } });
  const b = dwellEvent({ data: { queueWaitMs: 1000, processingMs: 6000 } });
  assert.notEqual(leanLedgerEventNaturalKey(a), leanLedgerEventNaturalKey(b));
});

test('key order inside data does not change the natural key (stable ordering)', () => {
  const a = { ...dwellEvent(), data: { queueWaitMs: 1000, processingMs: 5000 } };
  const b = { ...dwellEvent(), data: { processingMs: 5000, queueWaitMs: 1000 } };
  assert.equal(leanLedgerEventNaturalKey(a), leanLedgerEventNaturalKey(b));
});

test('hasLeanLedgerEvent finds an exact duplicate and rejects a genuinely new one', () => {
  const existing = [dwellEvent()];
  assert.equal(hasLeanLedgerEvent(existing, dwellEvent()), true);
  assert.equal(hasLeanLedgerEvent(existing, bounceEvent()), false);
});

// ── per-ticket snapshot: pure fold ──────────────────────────────────────

test('folding no events for a ticket yields an empty, well-formed snapshot', () => {
  const snapshot = foldLeanLedgerSnapshot('BL-819', []);
  assert.deepEqual(snapshot, {
    ticket: 'BL-819',
    stagesEntered: [],
    dwell: [],
    bounceCount: 0,
    bounces: [],
    skips: [],
    stalls: [],
    closed: false,
    closedAt: null,
  });
});

test('folding filters to only the requested ticket\'s events', () => {
  const events = [dwellEvent(), dwellEvent({ ticket: 'BL-820' })];
  const snapshot = foldLeanLedgerSnapshot('BL-819', events);
  assert.equal(snapshot.dwell.length, 1);
});

test('stage_transition events accumulate dwell and dedupe stagesEntered by role', () => {
  const events = [
    dwellEvent({ role: 'coder', at: '2026-08-07T10:00:00.000Z' }),
    dwellEvent({ role: 'cleaner', at: '2026-08-07T11:00:00.000Z' }),
    dwellEvent({ role: 'coder', at: '2026-08-07T12:00:00.000Z', data: { queueWaitMs: 0, processingMs: 100 } }),
  ];
  const snapshot = foldLeanLedgerSnapshot('BL-819', events);
  assert.deepEqual(snapshot.stagesEntered, ['coder', 'cleaner']);
  assert.equal(snapshot.dwell.length, 3);
});

test('bounce events accumulate and bounceCount tracks the list length, never a separately-trusted counter', () => {
  const events = [bounceEvent(), bounceEvent({ at: '2026-08-08T00:00:00.000Z', data: { ...bounceEvent().data, commit: 'def1234567' } })];
  const snapshot = foldLeanLedgerSnapshot('BL-819', events);
  assert.equal(snapshot.bounceCount, 2);
  assert.equal(snapshot.bounces.length, 2);
});

test('a close event marks the snapshot closed with the event\'s own timestamp, and folding is order-independent', () => {
  const closeEvt = { ticket: 'BL-819', type: 'close', source: 'backlog-close', at: '2026-08-09T00:00:00.000Z', data: { folder: 'done' } };
  const forward = foldLeanLedgerSnapshot('BL-819', [dwellEvent(), closeEvt]);
  const backward = foldLeanLedgerSnapshot('BL-819', [closeEvt, dwellEvent()]);
  assert.equal(forward.closed, true);
  assert.equal(forward.closedAt, '2026-08-09T00:00:00.000Z');
  assert.deepEqual(forward, backward);
});

test('a stage-entry event (no processingMs) registers stagesEntered but contributes no dwell record on its own', () => {
  const entryOnly = { ticket: 'BL-819', type: 'stage_transition', source: 'stage-dwell', at: '2026-08-07T08:05:00.000Z', role: 'coder', data: { queueWaitMs: 300000 } };
  const snapshot = foldLeanLedgerSnapshot('BL-819', [entryOnly]);
  assert.deepEqual(snapshot.stagesEntered, ['coder']);
  assert.deepEqual(snapshot.dwell, []);
});

test('a stage-entry paired with its stage-exit folds into one combined dwell record, queueWaitMs backfilled from the entry', () => {
  const entryEvt = { ticket: 'BL-819', type: 'stage_transition', source: 'stage-dwell', at: '2026-08-07T08:05:00.000Z', role: 'coder', data: { queueWaitMs: 300000 } };
  const exitEvt = { ticket: 'BL-819', type: 'stage_transition', source: 'stage-dwell', at: '2026-08-07T09:00:00.000Z', role: 'coder', data: { processingMs: 3300000 } };
  const snapshot = foldLeanLedgerSnapshot('BL-819', [entryEvt, exitEvt]);
  assert.deepEqual(snapshot.dwell, [{ role: 'coder', queueWaitMs: 300000, processingMs: 3300000, at: '2026-08-07T09:00:00.000Z' }]);
});

test('stage_skip and stall events fold into their own lists', () => {
  const skipEvt = { ticket: 'BL-819', type: 'stage_skip', source: 'routing-skip-log', at: '2026-08-07T09:00:00.000Z', role: 'hardener', data: { reason: 'no test infra for this file type' } };
  const stallEvt = { ticket: 'BL-819', type: 'stall', source: 'chaser-telemetry', at: '2026-08-07T09:30:00.000Z', role: 'coder', data: { eventType: 'chase', count: 2 } };
  const snapshot = foldLeanLedgerSnapshot('BL-819', [skipEvt, stallEvt]);
  assert.deepEqual(snapshot.skips, [{ role: 'hardener', reason: 'no test infra for this file type', at: '2026-08-07T09:00:00.000Z' }]);
  assert.deepEqual(snapshot.stalls, [{ role: 'coder', eventType: 'chase', count: 2, at: '2026-08-07T09:30:00.000Z' }]);
});
