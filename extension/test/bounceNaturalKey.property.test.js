const assert = require('node:assert/strict');
const fc = require('fast-check');
const { bounceNaturalKey, hasBounceRecord, bounceAttribution } = require('../out/quality/qaBounce');

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

const KNOWN_CLASSES = ['compile', 'unit', 'integration', 'acceptance', 'behavior'];
const KNOWN_TYPES = ['feature', 'defect', 'chore', 'docs', 'enhancement', 'epic'];
const KNOWN_PRODUCING = ['coder', 'cleaner', 'architect', 'hardender', 'documenter'];
const KNOWN_BOUNCE_ROLES = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

// Deliberately SMALL domains for the five key components, so distinct
// records collide on some components and differ on others on most runs - a
// wide-open generator would make every pair differ everywhere and the
// partition claim would hold vacuously.
const ticketArb = fc.constantFrom('BL-590', 'BL-606', 'BL-635');
const commitArb = fc.constantFrom('aaaa111111', 'bbbb222222', 'cccc333333');
const dayArb = fc.constantFrom('2026-07-24', '2026-07-25', '2026-07-26');
const timeOfDayArb = fc.constantFrom('00:00:00.000Z', '09:30:00.000Z', '23:59:59.999Z');
const classArb = fc.constantFrom(...KNOWN_CLASSES);
// `by` absent is a first-class case: the 53 legacy records have no `by` and
// must partition together under `unattributed`, never merge with a named role.
const byArb = fc.option(fc.constantFrom(...KNOWN_BOUNCE_ROLES), { nil: undefined });
// Components that must NOT participate in the key.
const producingArb = fc.constantFrom(...KNOWN_PRODUCING);
const typeArb = fc.constantFrom(...KNOWN_TYPES);

const recordArb = fc
  .record({
    ticket: ticketArb,
    commit: commitArb,
    day: dayArb,
    timeOfDay: timeOfDayArb,
    failureClass: classArb,
    by: byArb,
    producingRole: producingArb,
    ticketType: typeArb,
  })
  .map(({ day, timeOfDay, ...rest }) => ({ ...rest, at: `${day}T${timeOfDay}` }));

// A SECOND record derived from the first by perturbing an explicitly chosen
// subset of fields. Two independent recordArb draws almost never land on the
// interesting near-collisions - notably "same five key components, different
// TIME of day", the state that catches an over-fine key. Measured: an
// independent-pair generator reaches it on well under 1% of draws, so an
// over-fine key survived 100 runs. Deriving `b` from `a` makes every
// near-collision a first-class, frequently-generated case, and
// `assertPairCoverage` below fails the run outright if any of them stopped
// being reached (engineering.prompt's generator-reach requirement: a
// property that never visits the deep state is vacuous, not passing).
const PERTURBABLE = ['ticket', 'commit', 'day', 'timeOfDay', 'failureClass', 'by', 'producingRole', 'ticketType'];

const pairArb = fc
  .tuple(
    recordArb,
    fc.subarray(PERTURBABLE),
    fc.record({
      ticket: ticketArb,
      commit: commitArb,
      day: dayArb,
      timeOfDay: timeOfDayArb,
      failureClass: classArb,
      by: byArb,
      producingRole: producingArb,
      ticketType: typeArb,
    })
  )
  .map(([a, fields, fresh]) => {
    const b = { ...a };
    for (const f of fields) {
      if (f === 'day') {
        b.at = `${fresh.day}T${a.at.slice(11)}`;
      } else if (f === 'timeOfDay') {
        b.at = `${b.at.slice(0, 10)}T${fresh.timeOfDay}`;
      } else if (f === 'by') {
        b.by = fresh.by;
      } else {
        b[f] = fresh[f];
      }
    }
    return [a, b];
  });

function keyComponentsMatch(a, b) {
  return (
    a.ticket === b.ticket &&
    a.at.slice(0, 10) === b.at.slice(0, 10) &&
    a.failureClass === b.failureClass &&
    a.commit === b.commit &&
    bounceAttribution(a) === bounceAttribution(b)
  );
}

// The states this property is worthless without. Each names a way the key
// could be wrong that only shows up on a pair that AGREES everywhere else.
const PAIR_CATEGORIES = {
  'differs only in `by`': (a, b) => keyFieldsEqualExcept(a, b, 'by') && bounceAttribution(a) !== bounceAttribution(b),
  'differs only in time-of-day': (a, b) => keyFieldsEqualExcept(a, b, null) && a.at !== b.at,
  'differs only in producingRole/ticketType': (a, b) =>
    keyFieldsEqualExcept(a, b, null) && a.at === b.at && (a.producingRole !== b.producingRole || a.ticketType !== b.ticketType),
  'identical in every key component': (a, b) => keyComponentsMatch(a, b),
  'differs in a key component': (a, b) => !keyComponentsMatch(a, b),
};

// Equal on every key component except optionally the named one (`null` =
// equal on all five, so only non-key fields or time-of-day may differ).
function keyFieldsEqualExcept(a, b, except) {
  const same = {
    ticket: a.ticket === b.ticket,
    day: a.at.slice(0, 10) === b.at.slice(0, 10),
    failureClass: a.failureClass === b.failureClass,
    commit: a.commit === b.commit,
    by: bounceAttribution(a) === bounceAttribution(b),
  };
  return Object.entries(same).every(([k, v]) => (k === except ? true : v));
}

function assertPairCoverage(seen) {
  const missed = Object.keys(PAIR_CATEGORIES).filter((c) => !seen.has(c));
  assert.deepEqual(missed, [], `generator never reached: ${missed.join(', ')} - the property would pass vacuously there`);
}

test('property: two bounce records share a natural key EXACTLY when their five key components match - never coarser (which would pool an architect send-back with a QA bounce), never finer (which would break idempotency)', () => {
  const seen = new Set();
  fc.assert(
    fc.property(pairArb, ([a, b]) => {
      for (const [name, matches] of Object.entries(PAIR_CATEGORIES)) {
        if (matches(a, b)) {
          seen.add(name);
        }
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
