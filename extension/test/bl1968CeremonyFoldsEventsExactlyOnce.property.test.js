'use strict';

// BL-1968's declared invariant (property authorship rests with the coder,
// first pass - BL-654): every lifecycle ledger event is folded by exactly
// one ceremony run - the first run after it was appended - regardless of
// the date in its `at` stamp; no event is folded twice and none is
// skipped. Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs). Mirrors BL-1967's own sibling property
// (bl1967CeremonyRunWindowTiling.property.test.js) in shape and tooling.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { propertyLaneTimeoutMs } = require('./helpers/propertyLaneContentionBudget');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const { runClosingCeremony } = require('../out/metrics/closingCeremonyRun');
const { appendLeanLedgerEventIfNew } = require('../out/metrics/leanLedgerStore');

function mkTmp() {
  return mkTmpDir('sfvc-bl1968-fold-once-');
}

function noThrowDeps() {
  return { sendNote: () => {} };
}

function dayInstant(dayOffset) {
  return new Date(Date.UTC(2026, 0, 1 + dayOffset, 4, 25, 0)).toISOString();
}

// Each run's own day gets 0, 1 or several events, and - for the
// midnight-stamp shape - a bounce whose `at` is always midnight (so an
// `at`-based fold would misplace it) rather than the real moment it was
// recorded. Every shape is reached BY CONSTRUCTION (cell index), never a
// weighted draw: an event count of exactly 0 for some run is exactly as
// able to hide a double-fold or a skip as a run with several, so each gets
// its own dedicated pass.
const SHAPES = {
  zeroOrOnePerRun: (i) => (i % 2 === 0 ? 0 : 1),
  severalPerRun: (i) => 1 + (i % 3),
  midnightStampedBounces: (i) => (i % 2 === 0 ? 1 : 0), // bounce shape below ignores the count and always appends one bounce on odd runs
};
const SHAPE_KEYS = Object.keys(SHAPES);
const SHAPE_CELL_RUNS = runsPerCell(24, SHAPE_KEYS.length);

function appendEventsForRun(target, runIndex, count, ticketsOut, shape) {
  const day = dayInstant(runIndex).slice(0, 10);
  for (let k = 0; k < count; k += 1) {
    const ticket = `BL-${9000 + runIndex * 10 + k}`;
    ticketsOut.push(ticket);
    const isBounce = shape === 'midnightStampedBounces' && runIndex % 2 === 1 && k === 0;
    appendLeanLedgerEventIfNew(target, isBounce
      ? {
          ticket,
          type: 'bounce',
          source: 'bounce-store',
          // Always midnight, whatever hour this run actually happened at -
          // the exact premise the ticket's invariant must hold under.
          at: `${day}T00:00:00.000Z`,
          data: { blamedRole: 'coder', failureClass: 'property-fixture', commit: 'abc1234567' },
        }
      : {
          ticket,
          type: 'stage_transition',
          source: 'stage-dwell',
          at: `${day}T${String(1 + (k % 20)).padStart(2, '0')}:00:00.000Z`,
          role: 'coder',
          data: { processingMs: 1000 },
        });
  }
}

function runSequence(target, n, shape, buildCount) {
  const tickets = [];
  const foldedBy = new Map(); // ticket -> [runIndex, ...]
  for (let i = 0; i < n; i += 1) {
    appendEventsForRun(target, i, buildCount(i), tickets, shape);
    const { run } = runClosingCeremony(target, dayInstant(i), noThrowDeps());
    for (const event of run.packet.leanLedgerEvents) {
      const list = foldedBy.get(event.ticket) ?? [];
      list.push(i);
      foldedBy.set(event.ticket, list);
    }
  }
  return { tickets, foldedBy };
}

test(
  'BL-1968 invariant: every lifecycle ledger event is folded by exactly one ceremony run, never twice and never skipped',
  () => {
    const reach = { zeroOrOnePerRun: 0, severalPerRun: 0, midnightStampedBounces: 0 };

    for (const [shape, buildCount] of Object.entries(SHAPES)) {
      fc.assert(
        fc.property(fc.integer({ min: 2, max: 6 }), (n) => {
          reach[shape] += 1;
          const target = mkTmp();
          const { tickets, foldedBy } = runSequence(target, n, shape, buildCount);

          for (const ticket of tickets) {
            const runs = foldedBy.get(ticket) ?? [];
            assert.equal(runs.length, 1, `expected ${ticket} folded by exactly one run, got runs ${JSON.stringify(runs)} (shape=${shape}, n=${n})`);
          }
          // No run folded an event nobody appended (foldedBy only ever
          // gains entries from actual appends, so this is really asserting
          // foldedBy holds no stray key - a mutation-killing redundancy).
          for (const foldedTicket of foldedBy.keys()) {
            assert.ok(tickets.includes(foldedTicket), `packet folded an event never appended: ${foldedTicket}`);
          }
          return true;
        }),
        { numRuns: SHAPE_CELL_RUNS }
      );
    }

    assertReachFloor(reach, SHAPE_KEYS, SHAPE_CELL_RUNS, 'shape');
  },
  propertyLaneTimeoutMs(20000)
);
