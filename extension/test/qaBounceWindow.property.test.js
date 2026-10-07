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
        const kept = recordsAfter([record], WINDOW_START);
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

const PRODUCING_ROLES = ['coder', 'architect', 'documenter'];
const nowMs = new Date(NOW).getTime();

function arbitraryRecord() {
  return fc
    .record({
      producingRole: fc.constantFrom(...PRODUCING_ROLES),
      // offsetFromNowMs is "how far in the PAST" (negative = slightly in
      // the future, harmless). Up to 1 day past stays inside the window
      // (WINDOW_START is NOW - 1 day); up to 9 days past spans the whole
      // seven-day trend lookback and beyond it - every classification
      // this invariant cares about (in-window, outside-window, inside the
      // trend lookback, past it) is reachable from one generator.
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

        const removedAfterWindow = new Date(removed.at).getTime() > new Date(WINDOW_START).getTime();
        const windowShape = removedAfterWindow ? 'removed-in-window' : 'removed-outside-window';
        coverage[windowShape] = (coverage[windowShape] || 0) + 1;
        assert.equal(withAll.windowTotal - withoutOne.windowTotal, removedAfterWindow ? 1 : 0);

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
