const assert = require('node:assert/strict');
const fc = require('fast-check');
const { computeTelegramBridgeCostForDay } = require('../out/metrics/telegramBridgeCost');

// BL-511 (architect, property-testing support): computeTelegramBridgeCostForDay
// is the pure attribution core this ticket introduced - telegramBridgeCost.test.js
// pins it with a handful of hand-picked record lists (0/1/2 records, known/unknown
// cost, in/out of day); the invariant that EVERY known-cost, same-day record's cost
// is summed exactly once, every unknown-cost same-day record is counted but excluded
// from the total, and every other-day record is ignored entirely, holds for any list
// of records - not just those examples. This is the "conservation/counting" shape
// architect.prompt's Property Testing section names, and it is exactly what the
// human's "never invent a cost, never drop a real one" exact-cost basis depends on.

const DAY = '2026-07-18';
const OTHER_DAY = '2026-07-17';

// null = unknown cost (honest-null discipline); a number = a known cost, kept small
// and exact so floating-point summation stays exact for the equality assertions below.
const costArb = fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 1000 }).map((c) => c / 100));
const dayArb = fc.constantFrom(DAY, OTHER_DAY);

const recordArb = fc.record({
  day: dayArb,
  total_cost_usd: costArb,
});

function toRecord({ day, total_cost_usd }, i) {
  return { ts: `${day}T${String(i % 24).padStart(2, '0')}:00:00Z`, kind: 'front-desk', total_cost_usd };
}

test('property: every known-cost same-day record is summed exactly once, every unknown-cost same-day record is counted but excluded, every other-day record is ignored', () => {
  fc.assert(
    fc.property(fc.array(recordArb, { maxLength: 40 }), (specs) => {
      const records = specs.map(toRecord);
      const summary = computeTelegramBridgeCostForDay(records, DAY);

      const sameDay = specs.filter((s) => s.day === DAY);
      const known = sameDay.filter((s) => s.total_cost_usd !== null);
      const unknown = sameDay.filter((s) => s.total_cost_usd === null);
      const expectedTotal = known.reduce((sum, s) => sum + s.total_cost_usd, 0);

      assert.equal(summary.frontDeskCount, sameDay.length, 'frontDeskCount must count every same-day record, known or unknown');
      assert.equal(summary.unknownCount, unknown.length, 'unknownCount must count every same-day unknown-cost record');
      assert.ok(
        Math.abs(summary.totalUsd - expectedTotal) < 1e-9,
        `totalUsd=${summary.totalUsd} expected=${expectedTotal} for known costs [${known.map((s) => s.total_cost_usd)}]`
      );
      assert.equal(summary.totalUsd, summary.frontDeskUsd, 'front-desk is the only source, so totalUsd and frontDeskUsd must agree');
      assert.equal(summary.frontDeskCount, summary.unknownCount + known.length, 'known + unknown must conserve to frontDeskCount');
    })
  );
});
