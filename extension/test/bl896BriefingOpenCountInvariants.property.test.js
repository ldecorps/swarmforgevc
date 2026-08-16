const assert = require('node:assert/strict');
const fc = require('fast-check');
const { computeNotDoneBurndownSeries } = require('../out/metrics/notDoneBurndown');

// BL-896 declared invariant 1 (BL-654): "Every ticket count the briefing
// states matches the backlog's actual lane contents on the day it is
// stated." F3 found that deriveTicketLifecycles never assigns a close date
// to a ticket retired by deleting its YAML rather than moving it under
// backlog/done/, so the lifecycle-only model can diverge from what is
// really on disk today. computeNotDoneBurndownSeries's `currentOpenTicketIds`
// parameter reconciles TODAY's point against that live set - this property
// generates arbitrary lifecycle models that diverge from an arbitrary live
// set and asserts today's stated count always tracks the live set, never
// the (possibly stale) lifecycle model. Runs ONLY via
// `npm run test:properties`, never the unit/coverage/mutation lane.
//
// Non-vacuity proven by hand at authoring time: this property fails
// (openN reports the lifecycle-open count instead of the live-set size)
// when computeNotDoneBurndownSeries's reconciliation block is removed -
// confirmed by temporarily deleting it, running this file, seeing the
// property fail on a divergent case, then restoring the fix.

const NOW_MS = Date.parse('2026-08-16T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

// Each generated ticket independently picks a lifecycle-model verdict
// (lifecycleOpen) and a ground-truth disk verdict (actuallyOnDisk) - the two
// are drawn independently so the generator reaches every combination,
// including the exact divergence (lifecycle says open, disk says gone) F3
// describes, not just the cases where the two happen to agree.
const ticketArb = fc.record({
  id: fc.integer({ min: 1, max: 999999 }).map((n) => `BL-${n}`),
  specOffsetDays: fc.integer({ min: 1, max: WINDOW_DAYS - 1 }),
  lifecycleOpen: fc.boolean(),
  actuallyOnDisk: fc.boolean(),
});

const ticketsArb = fc.uniqueArray(ticketArb, {
  selector: (t) => t.id,
  minLength: 0,
  maxLength: 40,
});

function toLifecycles(tickets) {
  return tickets.map((t) => ({
    ticketId: t.id,
    specDateIso: new Date(NOW_MS - t.specOffsetDays * DAY_MS).toISOString(),
    closeDateIso: t.lifecycleOpen ? null : new Date(NOW_MS - Math.max(t.specOffsetDays - 1, 0) * DAY_MS).toISOString(),
  }));
}

test('generator reach: sampling the ticket generator reaches a lifecycle-open/disk-closed divergence (retired-by-deletion) case', () => {
  const samples = fc.sample(ticketsArb, { numRuns: 300 });
  const reached = samples.some((tickets) => tickets.some((t) => t.lifecycleOpen && !t.actuallyOnDisk));
  assert.ok(reached, 'generator never produced a lifecycle-open/disk-closed ticket across 300 samples - the invariant would pass vacuously');
});

test('property: today\'s stated open count always matches the live open-ticket set, never the (possibly stale) lifecycle model', () => {
  fc.assert(
    fc.property(ticketsArb, (tickets) => {
      const lifecycles = toLifecycles(tickets);
      const currentOpenTicketIds = new Set(tickets.filter((t) => t.actuallyOnDisk).map((t) => t.id));
      const series = computeNotDoneBurndownSeries(lifecycles, NOW_MS, WINDOW_DAYS, currentOpenTicketIds);
      assert.equal(series.openN, currentOpenTicketIds.size);
      assert.equal(series.series[series.series.length - 1].remaining, currentOpenTicketIds.size);
    }),
    { numRuns: 300 }
  );
});
