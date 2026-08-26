const assert = require('node:assert/strict');
const fc = require('fast-check');
const { buildClosingCeremonyPacket } = require('../out/quality/closingCeremony');

// BL-923 (coder.prompt's Invariants section - first authorship rests with
// the coder): a coder-authored property test for this ticket's declared
// invariant 1 - "A role's dwell total is the time that role was occupied:
// one occupancy window contributes its own duration exactly once, however
// many parcels shared it. This holds for any batch size and for any role
// that later becomes a batch role." Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs); excluded from unit/coverage/mutation.
//
// Invariant 2 ("the per-parcel ledger events are not touched") is not
// encoded here: it quantifies over the DIFF's own scope (which functions
// changed), not over a pure function's behaviour across generated inputs -
// there is no generator input whose variation exercises "did the fix touch
// deriveOneDwellRecord/stageDwell.ts". Verified instead by diff review: only
// computeDwellHotspots and its two new private helpers changed in
// closingCeremony.ts; stageDwell.ts, leanLedger.ts's event shape, and
// hasLeanLedgerEventShape are untouched. Recorded per BL-654's
// non-encodability carve-out.
//
// Windows are built BY CONSTRUCTION, not as independently-random pairs that
// might rarely overlap: each window's start is the previous window's end
// plus a signed offset - negative creates overlap (including the identical-
// window batch case), positive creates a gap. This is exactly the
// transformation the defect conflates (sum vs union-of-intervals), so every
// generated case is an overlap/gap boundary case, not a coincidence.
//
// The expected total is computed by an INDEPENDENT method (100ms-bucket
// coverage counting, not the implementation's own sort-and-merge), so this
// is a real cross-check rather than a restatement of the algorithm under
// test. All durations/offsets are multiples of 100ms so bucket counting is
// exact, never an approximation.
//
// Non-vacuity, checked by hand before landing: reverting sumOccupiedMs to a
// plain `reduce((sum, iv) => sum + (iv.endMs - iv.startMs), 0)` (the exact
// pre-BL-923 defect) reliably fails this property within the first few
// generated cases - restoring the union-merge implementation makes it pass
// again. Confirmed together with the unit tests in the same break/restore
// pass (see closingCeremony.test.js's own BL-923 tests).

const BUCKET_MS = 100;
const ANCHOR_MS = Date.UTC(2026, 7, 8, 12, 0, 0); // 2026-08-08T12:00:00Z - noon, wide margin from any day boundary

const windowPlanArb = fc.array(
  fc.record({
    durationUnits: fc.integer({ min: 1, max: 50 }), // 100ms..5000ms
    offsetUnits: fc.integer({ min: -20, max: 20 }), // -2000ms..+2000ms relative to the previous window's end
  }),
  { minLength: 1, maxLength: 8 }
);

function buildEventsAndReference(plan) {
  let cursorEndMs = ANCHOR_MS;
  const intervals = [];
  plan.forEach((w, i) => {
    const durationMs = w.durationUnits * BUCKET_MS;
    const startMs = i === 0 ? ANCHOR_MS : cursorEndMs + w.offsetUnits * BUCKET_MS;
    const endMs = startMs + durationMs;
    intervals.push({ startMs, endMs });
    cursorEndMs = endMs;
  });

  const events = intervals.map((iv, i) => ({
    ticket: `BL-9${i}`,
    type: 'stage_transition',
    source: 'stage-dwell',
    role: 'coder',
    at: new Date(iv.endMs).toISOString(),
    data: { processingMs: iv.endMs - iv.startMs },
  }));

  const occupiedBuckets = new Set();
  for (const iv of intervals) {
    for (let b = iv.startMs / BUCKET_MS; b < iv.endMs / BUCKET_MS; b++) {
      occupiedBuckets.add(b);
    }
  }
  const referenceMs = occupiedBuckets.size * BUCKET_MS;

  return { events, referenceMs, shiftKey: events[0].at.slice(0, 10) };
}

test('property: dwell total equals the union of occupancy windows (independent bucket-coverage cross-check), for any batch size or overlap pattern', () => {
  fc.assert(
    fc.property(windowPlanArb, (plan) => {
      const { events, referenceMs, shiftKey } = buildEventsAndReference(plan);
      const packet = buildClosingCeremonyPacket(shiftKey, events);
      const hotspot = packet.dwellHotspots.find((h) => h.role === 'coder');
      const actualMs = hotspot ? hotspot.totalMs : 0;
      assert.equal(
        actualMs,
        referenceMs,
        `expected occupied dwell ${referenceMs}ms, got ${actualMs}ms for plan ${JSON.stringify(plan)}`
      );
      // A structural sanity bound alongside the cross-check: union time can
      // never exceed the naive sum (it only shrinks or stays equal when
      // windows overlap), and never be less than the single longest window.
      const summedMs = events.reduce((sum, e) => sum + e.data.processingMs, 0);
      const maxSingleMs = Math.max(...events.map((e) => e.data.processingMs));
      assert.ok(actualMs <= summedMs, `expected occupied time <= naive sum ${summedMs}ms, got ${actualMs}ms`);
      assert.ok(actualMs >= maxSingleMs, `expected occupied time >= longest single window ${maxSingleMs}ms, got ${actualMs}ms`);
    }),
    { numRuns: 200 }
  );
});

test('property: N parcels sharing the exact same window count that window exactly once, for any N', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 100, max: 10000 }), (parcelCount, processingMs) => {
      const atIso = new Date(ANCHOR_MS + processingMs).toISOString();
      const events = Array.from({ length: parcelCount }, (_, i) => ({
        ticket: `BL-9${i}`,
        type: 'stage_transition',
        source: 'stage-dwell',
        role: 'hardender',
        at: atIso,
        data: { processingMs },
      }));
      const packet = buildClosingCeremonyPacket(atIso.slice(0, 10), events);
      const hotspot = packet.dwellHotspots.find((h) => h.role === 'hardender');
      assert.equal(hotspot.totalMs, processingMs, `expected ${parcelCount} identical-window parcels to count once (${processingMs}ms), got ${hotspot.totalMs}ms`);
    }),
    { numRuns: 100 }
  );
});
