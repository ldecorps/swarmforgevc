// BL-572: pure decision core for the epic priority reorder screen - paths
// in (the paused epics' current order + which one moves which way) -> which
// backlog YAML files change and to what priority value, never touching a
// filesystem or a git repo itself. The bridge route (the IO edge) reads the
// paused epics, calls this, then applies the returned writes and commits
// them - consistent with expediteSafety.ts holding expedite's own pure
// collision logic outside its route handler.
//
// Reordering is a SWAP (exchange the mover's and its neighbour's priority
// values), never a renumber: untouched epics keep the value they already
// had. The one case a plain swap cannot handle is two adjacent epics
// already sharing one priority value - exchanging equal values is a
// no-op, so the list would look stuck. For that case only, the mover's
// priority is nudged one past its neighbour's (never touching the
// neighbour's own value), which is enough to produce a strict order
// without a second file write.

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

function findNeighborIndex(length: number, index: number, direction: ReorderDirection): number | null {
  const neighborIndex = direction === 'up' ? index - 1 : index + 1;
  return neighborIndex >= 0 && neighborIndex < length ? neighborIndex : null;
}

// The tie-break nudge (see file header): equal priorities swap to a no-op,
// so the mover's priority is pushed one step past its neighbour's instead,
// leaving the neighbour untouched.
function computeSwappedPriorities(
  selectedPriority: number,
  neighborPriority: number,
  direction: ReorderDirection
): { selected: number; neighbor: number } {
  if (selectedPriority !== neighborPriority) {
    return { selected: neighborPriority, neighbor: selectedPriority };
  }
  return direction === 'up'
    ? { selected: neighborPriority - 1, neighbor: neighborPriority }
    : { selected: neighborPriority + 1, neighbor: neighborPriority };
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
  const neighborIndex = findNeighborIndex(sortedEpics.length, index, direction);
  if (neighborIndex === null) {
    return null;
  }

  const selected = sortedEpics[index];
  const neighbor = sortedEpics[neighborIndex];
  const next = computeSwappedPriorities(selected.priority, neighbor.priority, direction);

  const writes: EpicPriorityWrite[] = [];
  if (next.selected !== selected.priority) {
    writes.push({ id: selected.id, priority: next.selected });
  }
  if (next.neighbor !== neighbor.priority) {
    writes.push({ id: neighbor.id, priority: next.neighbor });
  }
  return { writes };
}
