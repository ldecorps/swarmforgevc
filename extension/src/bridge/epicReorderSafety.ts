// BL-572: pure decision core for the epic priority reorder screen - paths in
// (the paused epics' current order + which one moves which way) -> which
// backlog YAML files change and to what priority value, never touching a
// filesystem or a git repo itself. The bridge route (the IO edge) reads the
// paused epics, calls this, then applies the returned writes and commits
// them - consistent with expediteSafety.ts holding expedite's own pure
// collision logic outside its route handler.
//
// `priority` is only a PARTIAL order key: sortEpicsByPriority breaks ties by
// id ascending. A move must be defined over the resulting POSITION in that
// sorted list, not over raw priority values - architect bounce #1
// (backlog/evidence/BL-572-architect-bounce1-20260726.md) found that a naive
// value swap, or a tie-break nudge past an entire run of tied epics, can
// silently reorder a THIRD, untouched epic whenever the chosen value
// collides with one it already holds.
//
// Architect bounce #2 (backlog/evidence/BL-572-architect-bounce2-20260726.md)
// then found that the bounce #1 fix - a value swap clamped to a two-slot
// window, REFUSING the move when that window collapsed - silently refused 14
// of 24 possible moves against the real backlog (every move inside a run
// tied at the priority floor). The ticket was amended: a tie-case move may
// no longer refuse. It instead REWRITES values, extending the write set to
// epics at or after the moved pair (never above it, never negative) until
// the one-position change is achieved. This module implements that: a move
// is never refused except at the true list boundary (first epic up / last
// epic down).

export type ReorderDirection = 'up' | 'down';

export interface EpicPriorityItem {
  id: string;
  priority: number;
}

export interface PriorityWrite {
  id: string;
  priority: number;
}

export interface EpicReorderResult {
  writes: PriorityWrite[];
  changed: boolean;
  // Present exactly when changed is false - a human-readable reason the
  // console must display (architect bounce #2's second finding: a
  // changed:false response indistinguishable from success left the human
  // with no signal at all that a tap did nothing).
  reason?: string;
}

// Same ordering the screen displays (and the one the move route must find
// each epic's on-screen neighbour by): priority ascending, id ascending on
// ties. Never mutates its input.
export function sortEpicsByPriority<T extends EpicPriorityItem>(epics: T[]): T[] {
  return [...epics].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

function boundaryReason(direction: ReorderDirection): string {
  return direction === 'up'
    ? 'Already first in the list — nothing above it to move past.'
    : 'Already last in the list — nothing below it to move past.';
}

// Whether (candidateValue, candidateId) may legally sort immediately AFTER
// (refValue, refId) without needing a write: strictly greater, or tied with
// an id that already sorts after refId (the same tie-break rule the list is
// sorted by).
function ordersAfter(candidateValue: number, candidateId: string, refValue: number, refId: string): boolean {
  return candidateValue > refValue || (candidateValue === refValue && refId < candidateId);
}

// The smallest value the low slot's new occupant may take without sorting
// before the untouched epic just outside the window.
function slotFloor<T extends EpicPriorityItem>(beforeEpic: T | null, highEpic: T): number {
  return beforeEpic ? (beforeEpic.id < highEpic.id ? beforeEpic.priority : beforeEpic.priority + 1) : 0;
}

// The largest value the high slot's new occupant (lowEpic, completing the
// swap) may take without unsafely tying with the untouched epic just
// outside the high side of the window - when the plain swap target
// (highEpic's old value) already fits under this, the pair is a clean
// two-value swap (scenario 01's exact-value contract) and nothing past it
// needs touching; only when it does not does the cascade extend into
// afterEpic and beyond.
function slotCeiling<T extends EpicPriorityItem>(afterEpic: T | null, lowEpic: T): number | null {
  return afterEpic ? (lowEpic.id < afterEpic.id ? afterEpic.priority : afterEpic.priority - 1) : null;
}

function computeSlotBounds<T extends EpicPriorityItem>(
  sortedEpics: T[],
  lowIndex: number,
  highIndex: number,
  lowEpic: T,
  highEpic: T
): { floor: number; ceiling: number | null } {
  const beforeEpic = lowIndex > 0 ? sortedEpics[lowIndex - 1] : null;
  const afterEpic = highIndex < sortedEpics.length - 1 ? sortedEpics[highIndex + 1] : null;
  return { floor: slotFloor(beforeEpic, highEpic), ceiling: slotCeiling(afterEpic, lowEpic) };
}

// newLowValue's natural target is the other pair member's OLD value (a
// plain swap) - used whenever floor allows it, so the common case (distinct
// priorities, no tie collision) is exactly a two-value swap. highSlotTarget
// is that same plain-swap value, clamped to ceiling when it would not fit.
function computeSwapTargets(
  lowEpic: EpicPriorityItem,
  highEpic: EpicPriorityItem,
  floor: number,
  ceiling: number | null
): { newLowValue: number; highSlotTarget: number } {
  const newLowValue = Math.max(floor, lowEpic.priority);
  const highSlotTarget = ceiling !== null && highEpic.priority > ceiling ? ceiling : highEpic.priority;
  return { newLowValue, highSlotTarget };
}

// Position i's occupant after the swap: highIndex now holds lowEpic (moved
// down out of the low slot); every position after that keeps its original
// occupant. `natural` is that occupant's un-cascaded target value.
function cascadePositionOccupant<T extends EpicPriorityItem>(
  sortedEpics: T[],
  i: number,
  highIndex: number,
  lowEpic: T,
  highSlotTarget: number
): { epic: T; natural: number } {
  const epic = i === highIndex ? lowEpic : sortedEpics[i];
  const natural = i === highIndex ? highSlotTarget : epic.priority;
  return { epic, natural };
}

// Records a write only when the assigned value actually differs from what
// the epic already had - an unchanged position needs no YAML touched.
function maybeWrite(writes: PriorityWrite[], id: string, assignedPriority: number, previousPriority: number): void {
  if (assignedPriority !== previousPriority) {
    writes.push({ id, priority: assignedPriority });
  }
}

// From the high slot onward, values cascade: whenever a position's natural
// target does not already sort after what was just assigned, it is bumped
// to one more than that. Because the low slot is never assigned below
// `floor` and nothing here is ever assigned below what preceded it, the
// cascade never has to go negative and never runs out of integers above it
// - a move is never refused for lack of room. The walk stops the moment a
// position needs no change at all: everything past it was already
// correctly ordered relative to it before this move touched anything, so
// nothing further can need touching either.
function cascadeWrites<T extends EpicPriorityItem>(
  sortedEpics: T[],
  highIndex: number,
  lowEpic: T,
  highEpic: T,
  newLowValue: number,
  highSlotTarget: number
): PriorityWrite[] {
  const writes: PriorityWrite[] = [];
  maybeWrite(writes, highEpic.id, newLowValue, highEpic.priority);

  let prevValue = newLowValue;
  let prevId = highEpic.id;
  for (let i = highIndex; i < sortedEpics.length; i++) {
    const { epic, natural } = cascadePositionOccupant(sortedEpics, i, highIndex, lowEpic, highSlotTarget);
    const assigned = ordersAfter(natural, epic.id, prevValue, prevId) ? natural : prevValue + 1;
    maybeWrite(writes, epic.id, assigned, epic.priority);
    prevValue = assigned;
    prevId = epic.id;
    if (assigned === epic.priority && i > highIndex) {
      break;
    }
  }

  return writes;
}

// computeEpicReorder treats a move as an adjacent transposition of the two
// SLOTS the selected epic and its on-screen neighbour occupy in the sorted
// array. The bound/target/cascade math is split into the helpers above
// (each kept at or under this project's CRAP<=6 gate) purely to satisfy
// that gate - the algorithm and its behavior are unchanged from a single
// function.
export function computeEpicReorder<T extends EpicPriorityItem>(
  sortedEpics: T[],
  selectedId: string,
  direction: ReorderDirection
): EpicReorderResult | null {
  const index = sortedEpics.findIndex((epic) => epic.id === selectedId);
  if (index === -1) {
    return null;
  }
  const neighborIndex = direction === 'up' ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= sortedEpics.length) {
    return { writes: [], changed: false, reason: boundaryReason(direction) };
  }

  const lowIndex = Math.min(index, neighborIndex);
  const highIndex = lowIndex + 1;
  const lowEpic = sortedEpics[lowIndex];
  const highEpic = sortedEpics[highIndex];

  const { floor, ceiling } = computeSlotBounds(sortedEpics, lowIndex, highIndex, lowEpic, highEpic);
  const { newLowValue, highSlotTarget } = computeSwapTargets(lowEpic, highEpic, floor, ceiling);
  const writes = cascadeWrites(sortedEpics, highIndex, lowEpic, highEpic, newLowValue, highSlotTarget);

  return { writes, changed: true };
}
