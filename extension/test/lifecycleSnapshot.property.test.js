const assert = require('node:assert/strict');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  lifecycleSnapshotPath,
  writeLifecycleSnapshot,
  readLifecycleSnapshot,
} = require('../out/metrics/lifecycleSnapshot');

// BL-897 (architect-owned property pass, per this ticket's own role prompt):
// lifecycleSnapshot.ts's whole job is a round-trip - writeLifecycleSnapshot
// then readLifecycleSnapshot at the SAME instant must reproduce the records
// verbatim, for any records array and any clock reading, not just the one
// two-record fixture lifecycleSnapshot.test.js pins by hand.
//
// Non-vacuity, checked by hand before landing: flipping isUsableSnapshot's
// `candidate.dayKey === utcDayKey(nowMs)` to `!==` (a same-instant write
// would then always be judged stale) reproduced the exact failure this
// property exists to catch - readLifecycleSnapshot returned null instead of
// the written records - and reverting made it pass again.

// .map({...r}) spreads fast-check's (sometimes null-prototype) generated
// record into a plain object - readLifecycleSnapshot's records always come
// back through JSON.parse (always Object.prototype), so without this a
// strict deepEqual would fail on prototype identity alone, never on the
// actual data the round-trip is meant to verify.
const recordArb = fc
  .record({
    ticketId: fc.string({ minLength: 1, maxLength: 24 }),
    specDateIso: fc.date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-01-01T00:00:00Z'), noInvalidDate: true }).map((d) => d.toISOString()),
    closeDateIso: fc.option(
      fc.date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-01-01T00:00:00Z'), noInvalidDate: true }).map((d) => d.toISOString()),
      { nil: null }
    ),
  })
  .map((r) => ({ ...r }));

const recordsArb = fc.array(recordArb, { maxLength: 20 });
const nowMsArb = fc.date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-01-01T00:00:00Z'), noInvalidDate: true }).map((d) => d.getTime());

test('property: writing then reading a snapshot at the same instant reproduces the records verbatim', () => {
  const dir = mkTmpDir('sfvc-lifecycle-snapshot-prop-');
  fc.assert(
    fc.property(recordsArb, nowMsArb, (records, nowMs) => {
      const written = writeLifecycleSnapshot(dir, records, nowMs);
      assert.equal(written, lifecycleSnapshotPath(dir));
      const readBack = readLifecycleSnapshot(written, nowMs);
      assert.deepEqual(readBack, records);
    }),
    { numRuns: 100 }
  );
});
