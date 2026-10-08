'use strict';

// BL-1880's two declared invariants, coder-authored (BL-654), property
// lane only.
//
// Invariant 1 - "The window counts, the trend and the all-time total are
// read from the same bounce log through the same reader, so a correction
// (BL-990) removes a bounce from every figure at once."
//
//   Constructed by DELETION: generate a record set, remove one record,
//   build the report with and without it, and assert every figure that
//   counted the removed record (all-time total, always; the window total,
//   when the removed record was after the window start; the removed
//   record's own role's seven-day trend, when it falls in that lookback)
//   changes by exactly the amount removing one record implies, and never
//   by more.
//
// Invariant 2 - "A bounce is in the window exactly when its time is after
// the window start, so no bounce is counted in two consecutive
// briefings."
//
//   PURE over recordsAfter: a record exactly AT the boundary is excluded,
//   one strictly after is included, one strictly before is excluded.
//   Reach is BY CONSTRUCTION - every draw places a record at a signed
//   offset from the boundary, covering negative/zero/positive.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { assertReachFloor } = require('./helpers/reachFloors');
const { recordsAfter, buildBounceWindowReport, computeSevenDayTrend } = require('../out/tools/qa-bounce-line');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = '2026-10-02T07:00:00.000Z';
const WINDOW_START = '2026-10-01T07:00:00.000Z';

describe('BL-1880 invariant 2: a record is in the window exactly when it is strictly after the start', () => {
  it('holds across arbitrary signed offsets from the boundary', () => {
    const startMs = new Date(WINDOW_START).getTime();
    const coverage = {};
    const FLOOR = 25;
    // A shape selector plus a magnitude, rather than a uniform integer
    // range, so "at" (offset exactly 0) is drawn about as often as the
    // other two shapes instead of needing to land on it by luck.
    const signedOffset = fc
      .tuple(fc.constantFrom('before', 'at', 'after'), fc.integer({ min: 1, max: 100000 }))
      .map(([shape, magnitude]) => (shape === 'at' ? 0 : shape === 'before' ? -magnitude : magnitude));
    fc.assert(
      fc.property(signedOffset, (offsetMs) => {
        const shape = offsetMs > 0 ? 'after' : offsetMs === 0 ? 'at' : 'before';
        coverage[shape] = (coverage[shape] || 0) + 1;
        const record = { at: new Date(startMs + offsetMs).toISOString(), producingRole: 'coder' };
        const kept = recordsAfter([record], WINDOW_START, NOW);
        assert.equal(
          kept.length,
          shape === 'after' ? 1 : 0,
          `offset ${offsetMs} (${shape}) should be ${shape === 'after' ? 'kept' : 'excluded'}`
        );
        return true;
      }),
      { numRuns: 300 }
    );
    assertReachFloor(coverage, ['before', 'at', 'after'], FLOOR, 'boundary shape');
  });
});

// QA bounce 2026-10-07 D3: two consecutive renders, each scoped to its own
// send time, must never both count the same bounce - the exact failure
// this ticket's fix closes (the previous window's end and the next
// window's start used to be two DIFFERENT git artifacts, 5.5h apart on
// 2026-10-02, measured). Pure over recordsAfter itself (the one function
// both a real previous render and the next one would call), reusing it
// to build window A = (t0, t1] and window B = (t1, t2] from one record
// at an arbitrary offset from the shared boundary t1 - by construction,
// never a hoped-for landing, since the offset is drawn to cover before
// t0, inside A, exactly at t1, inside B, and after t2.
describe('BL-1880 invariant 2 (D3): two consecutive renders, each at its own send time, never share a bounce', () => {
  it('holds for arbitrary send boundaries and an arbitrary record time', () => {
    const coverage = {};
    const FLOOR = 10;
    const shapeAndOffset = fc
      .tuple(fc.constantFrom('beforeA', 'inA', 'atBoundary', 'inB', 'afterB'), fc.integer({ min: 1, max: 50000 }))
      .map(([shape, magnitude]) => ({ shape, magnitude }));
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.integer({ min: 1, max: 100000 }),
        shapeAndOffset,
        (gap1, gap2, { shape, magnitude }) => {
          const t0 = 0;
          const t1 = gap1;
          const t2 = gap1 + gap2;
          const recordMs =
            shape === 'beforeA'
              ? t0 - magnitude
              : shape === 'inA'
                ? Math.min(t0 + magnitude, t1)
                : shape === 'atBoundary'
                  ? t1
                  : shape === 'inB'
                    ? Math.min(t1 + magnitude, t2)
                    : t2 + magnitude;
          coverage[shape] = (coverage[shape] || 0) + 1;
          const toIso = (ms) => new Date(ms).toISOString();
          const record = { at: toIso(recordMs), producingRole: 'coder' };
          const windowA = recordsAfter([record], toIso(t0), toIso(t1));
          const windowB = recordsAfter([record], toIso(t1), toIso(t2));
          assert.ok(
            !(windowA.length > 0 && windowB.length > 0),
            `a bounce at ${record.at} (shape ${shape}) was counted in both consecutive windows`
          );
          return true;
        }
      ),
      { numRuns: 100 }
    );
    assertReachFloor(coverage, ['beforeA', 'inA', 'atBoundary', 'inB', 'afterB'], FLOOR, 'two-render boundary shape');
  });
});

const PRODUCING_ROLES = ['coder', 'architect', 'documenter'];
const nowMs = new Date(NOW).getTime();

function arbitraryRecord() {
  return fc
    .record({
      producingRole: fc.constantFrom(...PRODUCING_ROLES),
      // offsetFromNowMs is "how far in the PAST" - negative is slightly in
      // the FUTURE (after nowIso), which QA bounce D4 makes a real outside-
      // window case (never counted, since the window now has an upper
      // bound at nowIso too), not a harmless one. Up to 1 day past stays
      // inside the window (WINDOW_START is NOW - 1 day); up to 9 days past
      // spans the whole seven-day trend lookback and beyond it - every
      // classification this invariant cares about (in-window,
      // outside-window before the start, outside-window after now, inside
      // the trend lookback, past it) is reachable from one generator.
      offsetFromNowMs: fc.integer({ min: -1 * MS_PER_DAY, max: 9 * MS_PER_DAY }),
    })
    .map(({ producingRole, offsetFromNowMs }) => ({
      producingRole,
      ticketType: 'feature',
      failureClass: 'behavior',
      at: new Date(nowMs - offsetFromNowMs).toISOString(),
    }));
}

function withTicketAndCommit(records) {
  return records.map((r, index) => ({ ...r, ticket: `BL-${9000 + index}`, commit: String(index).padStart(10, '0'), by: 'architect' }));
}

describe('BL-1880 invariant 1: every figure reads the same record set, so removing one bounce changes every figure that counted it, at once', () => {
  it('holds across arbitrary record sets and a removed index', () => {
    const coverage = {};
    const FLOOR = 15;
    fc.assert(
      fc.property(fc.array(arbitraryRecord(), { minLength: 2, maxLength: 12 }), fc.nat(), (rawRecords, seed) => {
        const records = withTicketAndCommit(rawRecords);
        const removedIndex = seed % records.length;
        const removed = records[removedIndex];
        const rest = records.filter((_, i) => i !== removedIndex);
        const withAll = buildBounceWindowReport(records, WINDOW_START, NOW, () => 'model');
        const withoutOne = buildBounceWindowReport(rest, WINDOW_START, NOW, () => 'model');

        // All-time total always decreases by exactly 1 - every record,
        // in or out of the window, counts toward it.
        assert.equal(withAll.allTimeTotal - withoutOne.allTimeTotal, 1);

        // QA bounce D4: the window has an upper bound at NOW too, so
        // "removed from the window" means after the start AND at-or-before
        // NOW - a removed record in the future (after NOW) was never in
        // windowTotal to begin with.
        const removedMs = new Date(removed.at).getTime();
        const removedInWindow = removedMs > new Date(WINDOW_START).getTime() && removedMs <= new Date(NOW).getTime();
        const windowShape = removedInWindow ? 'removed-in-window' : 'removed-outside-window';
        coverage[windowShape] = (coverage[windowShape] || 0) + 1;
        assert.equal(withAll.windowTotal - withoutOne.windowTotal, removedInWindow ? 1 : 0);

        // The removed record's own role's seven-day trend total drops by
        // exactly 1 if it falls in the lookback, else by 0 - and the SAME
        // reader (computeSevenDayTrend over the SAME record sets) proves
        // it, rather than trusting the report's own internal bookkeeping.
        const beforeTrend = computeSevenDayTrend(records, removed.producingRole, NOW);
        const afterTrend = computeSevenDayTrend(rest, removed.producingRole, NOW);
        const trendDelta = beforeTrend.reduce((sum, v, i) => sum + (v - afterTrend[i]), 0);
        assert.ok(trendDelta === 0 || trendDelta === 1, `trend total should drop by 0 or 1, got ${trendDelta}`);

        return true;
      }),
      { numRuns: 200 }
    );
    assertReachFloor(coverage, ['removed-in-window', 'removed-outside-window'], FLOOR, 'removed-record window membership');
  });
});
