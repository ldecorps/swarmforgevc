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

// Resolve the pair's target values against the window bounds: start from a
// plain value swap, clamp each side to stay within its own boundary, then -
// if that leaves the low slot not strictly below the high slot - free up
// room on whichever side still has it. Returns null when the window itself
// has no room left for two distinct values (both boundaries pinned to the
// same value, which can only happen when three or more epics are tied at
// the floor) - the move is refused rather than risk displacing an untouched
// epic or breaking the floor.
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
  if (ceiling === null || low + 1 <= ceiling) {
    return { low, high: low + 1 };
  }
  if (high - 1 >= floor) {
    return { low: high - 1, high };
  }
  return { low: floor, high: floor + 1 };
}

export function computeEpicReorder(
  sortedEpics: EpicPriorityItem[],
  selectedId: string,
  direction: ReorderDirection
): EpicReorderResult | null {
  const index = sortedEpics.findIndex((epic) => epic.id === selectedId);
  if (index === -1) {
    return null;
  }
  const neighborIndex = direction === 'up' ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= sortedEpics.length) {
    return null;
  }

  const lowIndex = Math.min(index, neighborIndex);
  const highIndex = Math.max(index, neighborIndex);
  const lowEpic = sortedEpics[lowIndex];
  const highEpic = sortedEpics[highIndex];
  const beforeEpic = lowIndex > 0 ? sortedEpics[lowIndex - 1] : null;
  const afterEpic = highIndex < sortedEpics.length - 1 ? sortedEpics[highIndex + 1] : null;

  // lowEpic and highEpic exchange slots: highEpic moves into the low index
  // and afterward must sort like lowEpic used to; lowEpic moves into the
  // high index and must sort like highEpic used to.
  const slots = computeSlotValues(
    lowEpic.priority,
    highEpic.priority,
    lowerLimit(beforeEpic, highEpic.id),
    upperLimit(afterEpic, lowEpic.id)
  );
  if (slots === null) {
    return null;
  }
  const { low, high } = slots;

  const writes: EpicPriorityWrite[] = [];
  if (low !== highEpic.priority) {
    writes.push({ id: highEpic.id, priority: low });
  }
  if (high !== lowEpic.priority) {
    writes.push({ id: lowEpic.id, priority: high });
  }
  return { writes };
}
