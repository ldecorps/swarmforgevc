// BL-572: pure decision core for the epic priority reorder screen - paths
// in (the paused epics' current order + which one moves which way) -> which
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
// computeEpicReorder treats a move as an adjacent transposition of the two
// SLOTS the selected epic and its on-screen neighbour occupy in the sorted
// array. Every other epic's priority never changes, so its relative order to
// every other unchanged epic is automatically preserved; the only work is
// picking two new values for the swapped pair that land strictly inside the
// two-slot window (between whatever unchanged epics sit just outside it).
// The default is the obvious value swap (each epic takes the other's old
// value); it is adjusted only where that default would land on or past one
// of those window boundaries. The value floor stays at 0 so a reorder can
// never outrank Expedite's `0`.
//
// Mutation note: a `<=`-for-`<` mutant on the id comparisons in lowerLimit/
// upperLimit is equivalent (unkillable) - ticket ids are always distinct, so
// localeCompare here never returns exactly 0. Likewise the beforeEpic/
// afterEpic boundary ternaries in findMoveWindow: forcing the out-of-range
// branch reads sortedEpics[-1] or sortedEpics[length], both `undefined`,
// which lowerLimit/upperLimit's `!boundary` check treats identically to the
// `null` the real branch would have produced. Nothing further to test here.

export interface EpicPriorityItem {
  id: string;
  priority: number;
}

export type ReorderDirection = 'up' | 'down';

export interface EpicPriorityWrite {
  id: string;
  priority: number;
}

export interface EpicReorderResult {
  writes: EpicPriorityWrite[];
}

// Same ordering the screen displays (and the one the move route must find
// each epic's on-screen neighbour by): priority ascending, id ascending on
// ties. Never mutates its input.
export function sortEpicsByPriority<T extends EpicPriorityItem>(epics: T[]): T[] {
  return [...epics].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

// The smallest priority the low-slot resident (identified by its id) may
// take without sorting before `boundary` (the untouched epic just outside
// the low side of the two-slot window) - a tie is fine when the boundary's
// own id already sorts first, since the standard tie-break then keeps it
// there untouched.
function lowerLimit(boundary: EpicPriorityItem | null, residentId: string): number {
  if (!boundary) {
    return 0;
  }
  return boundary.id.localeCompare(residentId) < 0 ? boundary.priority : boundary.priority + 1;
}

// The largest priority the high-slot resident (identified by its id) may
// take without sorting past `boundary` (the untouched epic just outside the
// high side of the window) - null when there is no such boundary (the
// window runs to the end of the list).
function upperLimit(boundary: EpicPriorityItem | null, residentId: string): number | null {
  if (!boundary) {
    return null;
  }
  return residentId.localeCompare(boundary.id) < 0 ? boundary.priority : boundary.priority - 1;
}

// The fallback when the plain value swap leaves the low slot not strictly
// below the high slot: free up room on the ceiling side if there's any,
// otherwise on the floor side. There is no third "both sides pinned" case -
// computeSlotValues already refused the move (returned null) whenever
// ceiling <= floor, and given ceiling > floor, `high` can only collapse to
// or below `floor` by inheriting a tight ceiling (see upperLimit), which
// makes it strictly greater than floor by that same guarantee. So whenever
// the ceiling side has no room, the floor side always does - broken out of
// computeSlotValues so each function's own CRAP score (100% covered, so
// score == cyclomatic complexity) stays at or under the project's CRAP<=6
// gate.
function resolveOverlappingSlots(
  low: number,
  high: number,
  ceiling: number | null
): { low: number; high: number } {
  if (ceiling === null || low + 1 <= ceiling) {
    return { low, high: low + 1 };
  }
  return { low: high - 1, high };
}

// Resolve the pair's target values against the window bounds: start from a
// plain value swap, clamp each side to stay within its own boundary, then
// hand off to resolveOverlappingSlots if that clamp collapsed the window.
// Returns null when the window itself has no room left for two distinct
// values (both boundaries pinned to the same value, which can only happen
// when three or more epics are tied at the floor) - the move is refused
// rather than risk displacing an untouched epic or breaking the floor.
function computeSlotValues(
  swapLow: number,
  swapHigh: number,
  floor: number,
  ceiling: number | null
): { low: number; high: number } | null {
  if (ceiling !== null && ceiling <= floor) {
    return null;
  }
  const low = Math.max(swapLow, floor);
  const high = ceiling === null ? swapHigh : Math.min(swapHigh, ceiling);
  if (low < high) {
    return { low, high };
  }
  return resolveOverlappingSlots(low, high, ceiling);
}

interface MoveWindow {
  lowEpic: EpicPriorityItem;
  highEpic: EpicPriorityItem;
  beforeEpic: EpicPriorityItem | null;
  afterEpic: EpicPriorityItem | null;
}

const NEIGHBOR_OFFSET: Record<ReorderDirection, number> = { up: -1, down: 1 };

// Locate the selected epic and its on-screen neighbour in the sorted list,
// plus whichever unchanged epics sit just outside that two-slot window (the
// boundaries computeSlotValues clamps against). Null when the selected epic
// is not in the list, or has no neighbour on the requested side.
function findMoveWindow(
  sortedEpics: EpicPriorityItem[],
  selectedId: string,
  direction: ReorderDirection
): MoveWindow | null {
  const index = sortedEpics.findIndex((epic) => epic.id === selectedId);
  if (index === -1) {
    return null;
  }
  const neighborIndex = index + NEIGHBOR_OFFSET[direction];
  if (neighborIndex < 0 || neighborIndex >= sortedEpics.length) {
    return null;
  }

  const lowIndex = Math.min(index, neighborIndex);
  const highIndex = Math.max(index, neighborIndex);
  return {
    lowEpic: sortedEpics[lowIndex],
    highEpic: sortedEpics[highIndex],
    beforeEpic: lowIndex > 0 ? sortedEpics[lowIndex - 1] : null,
    afterEpic: highIndex < sortedEpics.length - 1 ? sortedEpics[highIndex + 1] : null,
  };
}

// lowEpic and highEpic exchange slots: highEpic moves into the low index and
// afterward must sort like lowEpic used to; lowEpic moves into the high
// index and must sort like highEpic used to. Omits a write for either side
// already holding its target value.
function buildSwapWrites(
  lowEpic: EpicPriorityItem,
  highEpic: EpicPriorityItem,
  slots: { low: number; high: number }
): EpicPriorityWrite[] {
  const writes: EpicPriorityWrite[] = [];
  if (slots.low !== highEpic.priority) {
    writes.push({ id: highEpic.id, priority: slots.low });
  }
  if (slots.high !== lowEpic.priority) {
    writes.push({ id: lowEpic.id, priority: slots.high });
  }
  return writes;
}

export function computeEpicReorder(
  sortedEpics: EpicPriorityItem[],
  selectedId: string,
  direction: ReorderDirection
): EpicReorderResult | null {
  const window = findMoveWindow(sortedEpics, selectedId, direction);
  if (window === null) {
    return null;
  }
  const { lowEpic, highEpic, beforeEpic, afterEpic } = window;

  const slots = computeSlotValues(
    lowEpic.priority,
    highEpic.priority,
    lowerLimit(beforeEpic, highEpic.id),
    upperLimit(afterEpic, lowEpic.id)
  );
  if (slots === null) {
    return null;
  }
  return { writes: buildSwapWrites(lowEpic, highEpic, slots) };
}
