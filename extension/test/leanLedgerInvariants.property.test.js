const assert = require('node:assert/strict');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { KNOWN_LEAN_LEDGER_SOURCES, KNOWN_LEAN_LEDGER_DATA_KEYS, hasLeanLedgerEventShape, foldLeanLedgerSnapshot } = require('../out/quality/leanLedger');
const { appendLeanLedgerEventIfNew, readLeanLedgerEvents, writeLeanLedgerSnapshotFor } = require('../out/metrics/leanLedgerStore');

// BL-819 (coder.prompt's Invariants section - first authorship rests with
// the coder): coder-authored property tests for this ticket's two declared
// invariants. Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs); excluded from the unit/coverage/mutation
// run per engineering.prompt's property-test separation rule.
//
// Non-vacuity, checked by hand before landing (both properties below):
//   - Invariant 1: commenting out leanLedgerStore.ts's
//     `if (hasLeanLedgerEvent(existing, event)) { return false; }` dedup
//     guard (simulating the exact regression this invariant guards - a
//     re-run/redelivery double-writing) reproduced the failure this
//     property is built to catch: readLeanLedgerEvents(target, ticket)
//     returned TWO copies of the same event where the property expects one,
//     and restoring the guard made it pass again.
//   - Invariant 2: relaxing leanLedger.ts's hasLeanLedgerEventShape to skip
//     the `Object.keys(data).every(...)` closed-key check (simulating a
//     composer that starts smuggling in an extra computed/narrated field)
//     reproduced the failure - a generated event with a foreign data key
//     was accepted where the property expects rejection - and restoring the
//     check made it pass again.

function mkTmp() {
  return mkTmpDir('sfvc-lean-ledger-invariants-');
}

const ticketArb = fc.integer({ min: 1, max: 999 }).map((n) => `BL-${n}`);
const isoArb = fc
  .tuple(fc.integer({ min: 2026, max: 2027 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }), fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }), fc.integer({ min: 0, max: 59 }))
  .map(([y, mo, d, h, mi, s]) => new Date(Date.UTC(y, mo - 1, d, h, mi, s)).toISOString());
const roleArb = fc.constantFrom('coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA');

// A well-formed event for a given source: `type` is always the FIRST type
// in KNOWN_LEAN_LEDGER_EVENT_TYPES here - which exact type is irrelevant to
// either invariant (both are about append/shape mechanics, not per-type
// fold semantics, which leanLedger.test.js already covers per type) - and
// `data` sticks to that source's own closed key list, each value a small
// generated primitive (standing in for a "verbatim instrument fact").
function eventArbFor(source, ticket) {
  const keys = KNOWN_LEAN_LEDGER_DATA_KEYS[source];
  const dataArb = fc.record(
    Object.fromEntries(keys.map((k) => [k, fc.oneof(fc.string({ maxLength: 20 }), fc.integer({ min: 0, max: 100000 }), fc.constant(null))]))
  );
  return fc.record({
    ticket: fc.constant(ticket),
    type: fc.constant('stage_transition'),
    source: fc.constant(source),
    at: isoArb,
    role: roleArb,
    data: dataArb,
  });
}

const wellFormedEventArb = fc.constantFrom(...KNOWN_LEAN_LEDGER_SOURCES).chain((source) => ticketArb.chain((ticket) => eventArbFor(source, ticket)));

// ── invariant 1: idempotent double-append; snapshot is always a pure fold ──

test('property: appending the same event twice (redelivery/re-run) leaves the ledger byte-identical to appending it once', () => {
  fc.assert(
    fc.property(fc.array(wellFormedEventArb, { minLength: 1, maxLength: 8 }), (events) => {
      const target = mkTmp();
      // Every event is appended, then IMMEDIATELY re-appended (simulating a
      // hook re-run / redelivery right after the original write) - the
      // second call for each event must be a no-op.
      for (const event of events) {
        appendLeanLedgerEventIfNew(target, event);
        const secondAppendResult = appendLeanLedgerEventIfNew(target, event);
        assert.equal(secondAppendResult, false, 're-appending an already-written event must report no-op');
      }
      const stored = readLeanLedgerEvents(target);
      // No event was double-counted: exactly one stored record per DISTINCT
      // generated event (fast-check may itself generate duplicate events in
      // one array - those collapse to one line too, which is the point).
      const distinctCount = new Set(events.map((e) => JSON.stringify(e))).size;
      assert.equal(stored.length, distinctCount);
    }),
    { numRuns: 100 }
  );
});

test('property: the per-ticket snapshot written by the store is always exactly foldLeanLedgerSnapshot over that ticket\'s own stored events - never an independent writer', () => {
  fc.assert(
    fc.property(ticketArb, fc.array(wellFormedEventArb, { minLength: 0, maxLength: 8 }), (ticket, rawEvents) => {
      const target = mkTmp();
      const sameTicketEvents = rawEvents.map((e) => ({ ...e, ticket }));
      for (const event of sameTicketEvents) {
        appendLeanLedgerEventIfNew(target, event);
      }
      const writtenSnapshot = writeLeanLedgerSnapshotFor(target, ticket);
      const expectedSnapshot = foldLeanLedgerSnapshot(ticket, readLeanLedgerEvents(target, ticket));
      assert.deepEqual(writtenSnapshot, expectedSnapshot);
    }),
    { numRuns: 100 }
  );
});

// ── invariant 2: every field traceable to a known instrument (enforceable half) ──

test('property: a well-formed event from any of the five known instruments always passes shape validation', () => {
  fc.assert(
    fc.property(wellFormedEventArb, (event) => {
      assert.equal(hasLeanLedgerEventShape(event), true);
    }),
    { numRuns: 100 }
  );
});

test('property: an event carrying ANY data key outside its own source\'s closed list is always rejected - the shape a computed/inferred/narrated field would need to sneak through', () => {
  fc.assert(
    fc.property(wellFormedEventArb, fc.string({ minLength: 1, maxLength: 12 }).filter((s) => /^[a-zA-Z]+$/.test(s)), fc.oneof(fc.string(), fc.integer()), (event, foreignKey, foreignValue) => {
      const allowedKeys = KNOWN_LEAN_LEDGER_DATA_KEYS[event.source];
      fc.pre(!allowedKeys.includes(foreignKey));
      const tampered = { ...event, data: { ...event.data, [foreignKey]: foreignValue } };
      assert.equal(hasLeanLedgerEventShape(tampered), false);
    }),
    { numRuns: 100 }
  );
});
