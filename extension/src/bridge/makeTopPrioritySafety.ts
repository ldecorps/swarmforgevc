// BL-672: pure decision core for the epic (and, per BL-673, topic)
// "make top priority" verb - one tap raises the target strictly above every
// other live item in the domination set (paused + hold, epics AND topics -
// active/ and done/ are never read or written here), bounded by its own
// transitive depends_on closure. Paths in, writes out - no filesystem, no
// git - same testable-core boundary as epicReorderSafety.ts beside it.
//
// The actual position change is NOT a bespoke bulk-cascade algorithm. It is
// built entirely out of computeEpicReorder's already-hardened adjacent-swap
// primitive (BL-572, three architect bounces: never reorders an untouched
// third item, never refuses inside a tied run, never goes negative) -
// walking the target up one slot at a time until it reaches its bound
// position reuses a proven property instead of re-deriving cascade math a
// fourth time. See backlog/evidence/BL-572-architect-bounce{1,2,3}-
// 20260726.md before touching either module.

import {
  EpicPriorityItem,
  PriorityWrite,
  computeEpicReorder,
  sortEpicsByPriority,
} from './epicReorderSafety';

export interface MakeTopItem extends EpicPriorityItem {
  dependsOn?: string[];
}

export type DependencyResolution = 'active' | 'done' | 'unknown';

export interface MakeTopResult {
  writes: PriorityWrite[];
  changed: boolean;
  // Present whenever changed is false (a refusal or a no-op), AND present on
  // a SUCCESSFUL move that landed short of the absolute top (a dependency
  // bound) - a human-readable reason the console must display either way
  // (same response-contract lesson as epicReorderSafety.ts's
  // EpicReorderResult - architect bounce #2/#3 - extended here because a
  // bounded SUCCESS needs explaining exactly as much as a refusal does).
  // Absent only for the unbounded, unremarkable case: changed:true landing
  // the target at the absolute top with nothing to explain.
  reason?: string;
}

interface DependencyTraversal {
  liveDeps: Set<string>;
  cycle: string[] | null;
  dangling: string | null;
}

// Walks depends_on transitively from targetId. An id present in the live
// domination set (byId) is followed recursively and recorded in liveDeps; an
// id absent from it is classified via resolveNonLiveDependency - 'active' and
// 'done' are satisfied/ignored terminal nodes (never recursed into, per the
// ticket's own scope: active is in flight, done is complete), 'unknown'
// (no backlog item resolves at all) is a dangling reference and refuses the
// whole move. Any cycle reached during the walk (not only one that returns
// to targetId itself) is likewise a refusal - a cyclic depends_on graph has
// no well-defined "worst-ranked dependency" to bound against.
function traverseLiveDependencies<T extends MakeTopItem>(
  byId: Map<string, T>,
  targetId: string,
  resolveNonLiveDependency: (id: string) => DependencyResolution
): DependencyTraversal {
  const liveDeps = new Set<string>();
  const onStack: string[] = [];
  const onStackSet = new Set<string>();
  let cycle: string[] | null = null;
  let dangling: string | null = null;

  function visit(id: string): void {
    if (cycle || dangling) {
      return;
    }
    if (onStackSet.has(id)) {
      cycle = [...onStack.slice(onStack.indexOf(id)), id];
      return;
    }
    onStack.push(id);
    onStackSet.add(id);
    const item = byId.get(id);
    for (const depId of item?.dependsOn ?? []) {
      if (cycle || dangling) {
        break;
      }
      if (byId.has(depId)) {
        liveDeps.add(depId);
        visit(depId);
      } else if (resolveNonLiveDependency(depId) === 'unknown') {
        dangling = depId;
      }
    }
    onStack.pop();
    onStackSet.delete(id);
  }

  visit(targetId);
  return { liveDeps, cycle, dangling };
}

function cycleReason(cycle: string[]): string {
  return `Cannot make top: depends_on forms a cycle (${cycle.join(' -> ')}).`;
}

function danglingReason(danglingId: string): string {
  return `Cannot make top: depends_on references unknown ticket '${danglingId}'.`;
}

function blockedReason(blockingIds: string[]): string {
  return (
    `Cannot make top: live dependenc${blockingIds.length === 1 ? 'y' : 'ies'} ` +
    `${blockingIds.join(', ')} currently rank${blockingIds.length === 1 ? 's' : ''} worse than the target - ` +
    'promoting it would deepen an existing dependency violation instead of resolving it.'
  );
}

function alreadyBestReason(boundId: string | null, dominationLabel: string): string {
  return boundId
    ? `Already positioned immediately after its live dependency '${boundId}' - nothing more is permitted while that dependency remains live.`
    : `Already the unique top of ${dominationLabel}.`;
}

// A successful move that lands the target somewhere other than the absolute
// top needs the same stated-reason treatment as a refusal or no-op - a human
// tapping "make top" and seeing the target land second, not first, needs to
// know why (BL-672 scenario 04) rather than reading it as a bug.
function boundedMoveReason(boundId: string): string {
  return `Bounded by live dependency '${boundId}' - landed immediately after it.`;
}

// Applies a batch of writes to an in-memory copy (never mutates the input),
// for re-sorting between successive single-slot moves.
function applyWrites<T extends MakeTopItem>(items: T[], writes: PriorityWrite[]): T[] {
  if (writes.length === 0) {
    return items;
  }
  const byId = new Map(writes.map((w) => [w.id, w.priority]));
  return items.map((item) => (byId.has(item.id) ? { ...item, priority: byId.get(item.id)! } : item));
}

// Walks the target up one adjacent slot at a time - each step is exactly
// computeEpicReorder's own proven 'up' move - until it reaches desiredIndex,
// accumulating only the NET final write per touched id (an id revisited
// across several steps writes once, at its last assigned value; an id whose
// walk-end value equals its starting value needs no write at all).
function walkToIndex<T extends MakeTopItem>(sortedItems: T[], targetId: string, desiredIndex: number): PriorityWrite[] {
  let current = sortedItems;
  const originalPriorityById = new Map(sortedItems.map((item) => [item.id, item.priority]));
  const latestPriorityById = new Map(originalPriorityById);

  let targetIndex = current.findIndex((item) => item.id === targetId);
  while (targetIndex > desiredIndex) {
    const result = computeEpicReorder(current, targetId, 'up');
    if (!result || !result.changed) {
      break;
    }
    for (const write of result.writes) {
      latestPriorityById.set(write.id, write.priority);
    }
    current = sortEpicsByPriority(applyWrites(current, result.writes));
    targetIndex = current.findIndex((item) => item.id === targetId);
  }

  const writes: PriorityWrite[] = [];
  for (const [id, priority] of latestPriorityById) {
    if (priority !== originalPriorityById.get(id)) {
      writes.push({ id, priority });
    }
  }
  return writes;
}

// sortedLiveItems must already be sorted (sortEpicsByPriority) over the full
// GLOBAL live set - every live (paused + hold) epic AND topic, never
// filtered by type (BL-672 approval_context #3) and never including active/
// or done/ items. Dependency resolution (traversal, refusal, the bound) is
// ALWAYS computed against this full global set - a live dependency can sit
// outside whatever narrower domination set is passed below (BL-673: a
// cross-epic dependency still bounds or refuses a within-epic move).
// resolveNonLiveDependency classifies any depends_on id NOT present here.
//
// dominationSet (default: sortedLiveItems itself, i.e. BL-672's own
// whole-backlog behavior, unchanged) is the narrower set the target must
// rank strictly above WHEN NO DEPENDENCY BOUNDS IT - BL-673 passes just the
// target's own epic's live topics, so "make top" means "top of my epic",
// not "top of the whole backlog". A dependency bound, when one exists,
// fully determines placement regardless of dominationSet (mirroring BL-672:
// a bounded target does not also have to out-rank its domination peers -
// landing immediately after the bound is the whole answer). dominationLabel
// only affects the human-readable "already best" wording.
export function computeMakeTopPriority<T extends MakeTopItem>(
  sortedLiveItems: T[],
  targetId: string,
  resolveNonLiveDependency: (id: string) => DependencyResolution,
  dominationSet: T[] = sortedLiveItems,
  dominationLabel = 'the live backlog'
): MakeTopResult | null {
  const targetIndex = sortedLiveItems.findIndex((item) => item.id === targetId);
  if (targetIndex === -1) {
    return null;
  }

  const byId = new Map(sortedLiveItems.map((item) => [item.id, item]));
  const { liveDeps, cycle, dangling } = traverseLiveDependencies(byId, targetId, resolveNonLiveDependency);

  if (cycle) {
    return { writes: [], changed: false, reason: cycleReason(cycle) };
  }
  if (dangling) {
    return { writes: [], changed: false, reason: danglingReason(dangling) };
  }

  const positionOf = (id: string): number => sortedLiveItems.findIndex((item) => item.id === id);
  const worseDeps = [...liveDeps].filter((id) => positionOf(id) > targetIndex).sort();
  if (worseDeps.length > 0) {
    return { writes: [], changed: false, reason: blockedReason(worseDeps) };
  }

  const betterDeps = [...liveDeps].filter((id) => positionOf(id) < targetIndex);
  const boundId =
    betterDeps.length > 0
      ? betterDeps.reduce((worst, id) => (positionOf(id) > positionOf(worst) ? id : worst))
      : null;

  let desiredIndex: number;
  if (boundId) {
    desiredIndex = positionOf(boundId) + 1;
  } else {
    // Only a peer CURRENTLY ranked better than target constrains anything -
    // a peer already ranked worse (regardless of some unrelated foreign
    // item sitting between them) is already dominated, full stop, and must
    // never trigger a move on its account (that was a real bug: an earlier
    // "reduced array" formulation miscounted exactly this case). Since a
    // better-ranked peer is by definition positioned BEFORE target, its
    // position is unaffected by target's own removal, so no reduced-array
    // reasoning is needed at all here - target simply walks up to occupy
    // the best (closest to top) such peer's current slot.
    const betterPeers = dominationSet.filter((item) => item.id !== targetId && positionOf(item.id) < targetIndex);
    desiredIndex =
      betterPeers.length > 0
        ? Math.min(...betterPeers.map((peer) => positionOf(peer.id)))
        : targetIndex;
  }

  if (desiredIndex === targetIndex) {
    return { writes: [], changed: false, reason: alreadyBestReason(boundId, dominationLabel) };
  }

  const writes = walkToIndex(sortedLiveItems, targetId, desiredIndex);
  return boundId ? { writes, changed: true, reason: boundedMoveReason(boundId) } : { writes, changed: true };
}
