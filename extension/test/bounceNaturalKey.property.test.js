const assert = require('node:assert/strict');
const fc = require('fast-check');
const { bounceNaturalKey, hasBounceRecord } = require('../out/quality/qaBounce');
const { recordArb, pairArb, classifyPair, assertPairCoverage, keyComponentsMatch } = require('./support/bounceKeyPairArb');

// BL-635 architect property pass: `bounceNaturalKey`/`hasBounceRecord` are
// the generalised store's dedup contract, NEW in this parcel and finer than
// the legacy qaBounceNaturalKey (which stays ticket+date+class). The unit
// suite pins it at three examples - commit differs, `by` differs, and a
// positive/negative lookup. The property below states the contract over the
// whole input range instead: the key is an EXACT partition on its five
// components (ticket, date-of-`at`, failureClass, commit, attribution), no
// coarser and no finer.
//
// Why this is worth a property rather than more examples: both failure
// directions are silent and both are the exact failures BL-635 exists to
// prevent.
//   - TOO COARSE (a component dropped from the key, `by` above all) collapses
//     an architect send-back and a QA bounce on the same ticket/day/class/
//     commit into one record - the pooling this whole ticket is about, and
//     the reason BL-590's four same-day send-backs must stay four.
//   - TOO FINE (time-of-day, producingRole or ticketType leaking in) breaks
//     idempotency, so a live write racing backfill-qa-bounces.js double-counts.
// An example-based test only ever pins the components someone thought to
// vary; this quantifies over all five at once, including the components that
// must NOT participate.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// BL-768: `pairArb` (every near-collision category, plus the general
// sweep), `classifyPair` and `assertPairCoverage` now live in
// ./support/bounceKeyPairArb.js, shared with this ticket's own acceptance
// step handlers - see that module for why coverage no longer depends on
// luck.

test('property: two bounce records share a natural key EXACTLY when their five key components match - never coarser (which would pool an architect send-back with a QA bounce), never finer (which would break idempotency)', () => {
  const seen = new Set();
  fc.assert(
    fc.property(pairArb, ([a, b]) => {
      for (const name of classifyPair(a, b)) {
        seen.add(name);
      }
      assert.equal(bounceNaturalKey(a) === bounceNaturalKey(b), keyComponentsMatch(a, b));
    })
  );
  assertPairCoverage(seen);
});

test('property: hasBounceRecord agrees with the key partition against a whole existing log, so a re-run is idempotent and a genuinely distinct bounce is never swallowed', () => {
  fc.assert(
    fc.property(fc.array(pairArb, { minLength: 0, maxLength: 6 }), pairArb, (existingPairs, [, candidate]) => {
      const existing = existingPairs.flat();
      assert.equal(
        hasBounceRecord(existing, candidate),
        existing.some((r) => keyComponentsMatch(r, candidate))
      );
    })
  );
});

test('property: re-offering any record already in the log is always a duplicate - the dedup check is idempotent under append', () => {
  fc.assert(
    fc.property(fc.array(recordArb, { minLength: 1, maxLength: 12 }), fc.nat(), (existing, pick) => {
      const already = existing[pick % existing.length];
      assert.equal(hasBounceRecord(existing, already), true);
      // and re-appending it would not change the partition the log induces
      const keysBefore = new Set(existing.map(bounceNaturalKey));
      const keysAfter = new Set([...existing, already].map(bounceNaturalKey));
      assert.deepEqual([...keysAfter].sort(), [...keysBefore].sort());
    })
  );
});
