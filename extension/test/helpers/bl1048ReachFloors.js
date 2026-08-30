'use strict';

// BL-1281: bl1048's reach floors, and the draw scheme that makes them
// reachable BY CONSTRUCTION rather than by a lucky seed.
//
// It lives here, not inline in the test, so the property lane and the
// acceptance drive the SAME generator and the SAME numbers the test drives -
// a second copy of either is the drift trap the engineering rules call out,
// and it is what would let this file go green while bl1048 quietly changed.

// The observation shapes. Each names how many parcels a ticket is observed in
// and, for the multi-observation ones, how the SECOND is derived from the
// first - never an independent second draw.
const SHAPES = [
  'none', // no parcel anywhere: must stay not-started
  'delivered-only', // inbox/new/ only: the defect BL-1048 closes
  'opened-only', // inbox/in_process/ only: the pre-existing behavior
  'both-states-same-role', // derived: flip the state at the SAME door
  'opened-then-delivered-downstream', // derived: advance the role, delivered
  'delivered-then-opened-downstream', // derived: advance the role, opened
];

// The floors bl1048 declared BEFORE BL-1281 touched it. They are load-bearing:
// BL-1062's own helper comment says that without them "a generator that
// silently stopped producing a value would pass green forever". BL-1281's
// invariant 2 says none may be lowered or dropped to make a run pass - the fix
// is that the draw now reaches them, NOT that the numbers moved.
const BL1048_REACH_FLOORS = {
  deliveredOnly: 8,
  openedOnly: 8,
  bothStatesSameRole: 4,
  crossRole: 6,
  deliveredNote: 4,
  deliveredBatched: 4,
  deliveredMasterResident: 2,
  noParcel: 4,
  closedButDelivered: 2,
};

// `fc` is passed in rather than required here so this module stays loadable
// from anywhere (the acceptance loads it outside vitest), and so there is
// exactly one fast-check instance in play.
function makeTicketArbitraries(fc, { roleCount }) {
  // The non-shape fields, named once, so a shape-pinned ticket is the SAME
  // arbitrary with one field replaced rather than a second hand-written record
  // that could drift from this one.
  const TICKET_FIELDS = {
    baseIndex: fc.integer({ min: 0, max: roleCount - 1 }),
    kind: fc.constantFrom('git_handoff', 'note'),
    batched: fc.boolean(),
    // Mostly active (the board's own membership set); a minority closed, so
    // the filter-active half of the widening is exercised too.
    active: fc.oneof({ arbitrary: fc.constant(true), weight: 4 }, { arbitrary: fc.constant(false), weight: 1 }),
  };

  const ticketArb = fc.record({ shape: fc.constantFrom(...SHAPES), ...TICKET_FIELDS });

  // The OLD scheme, kept so the property lane can show the fix is not
  // cosmetic: every ticket's shape drawn independently at p=1/6.
  const sampledDraw = () => fc.array(ticketArb, { minLength: 2, maxLength: 6 });

  // The NEW scheme: two pinned tickets of the cell's shape, then 0-4 free
  // ones. The same 2-6 ticket array the property always drew, with its
  // floor-bearing part built rather than sampled.
  const drawForShape = (shape) => {
    const pinned = fc.record({ ...TICKET_FIELDS, shape: fc.constant(shape) });
    return fc
      .tuple(pinned, pinned, fc.array(ticketArb, { minLength: 0, maxLength: 4 }))
      .map(([first, second, rest]) => [first, second, ...rest]);
  };

  return { TICKET_FIELDS, ticketArb, sampledDraw, drawForShape };
}

// The two floors that were at risk are keyed on `shape` alone, so they can be
// counted without touching a filesystem - which is what lets the property lane
// replay thousands of runs of the DRAW, the only thing the floors depend on.
function shapeFloorCoverage(tickets) {
  let deliveredOnly = 0;
  let openedOnly = 0;
  for (const ticket of tickets) {
    if (ticket.shape === 'delivered-only') deliveredOnly += 1;
    if (ticket.shape === 'opened-only') openedOnly += 1;
  }
  return { deliveredOnly, openedOnly };
}

// Invariant 2's predicate: no declared floor may disappear or shrink. Returns
// the offending entries, so a caller can name them.
function weakenedFloors(before, after) {
  const offenders = [];
  for (const [value, floor] of Object.entries(before)) {
    if (!(value in after)) {
      offenders.push(`${value}: declared at ${floor} before, now absent`);
    } else if (after[value] < floor) {
      offenders.push(`${value}: lowered from ${floor} to ${after[value]}`);
    }
  }
  return offenders;
}

module.exports = { SHAPES, BL1048_REACH_FLOORS, makeTicketArbitraries, shapeFloorCoverage, weakenedFloors };
