// BL-672: pure decision core for the epic (and, per BL-673, topic)
// "make top priority" verb - one tap raises the target strictly above every
// other live item in the domination set (paused + hold, epics AND topics -
// active/ and done/ are never read or written here), bounded by its own
// transitive depends_on closure. Paths in, writes out - no filesystem, no
// git - same testable-core boundary as epicReorderSafety.ts beside it.
//
// BL-687: the ORDERING array (sortedLiveItems, walked by walkToIndex) and
// the DEPENDENCY-LIVENESS set (dependencyLiveItems, used only to classify a
// depends_on id as live vs resolveNonLiveDependency's terminal) are two
// separate parameters precisely so a caller CAN widen the former (the
// within-epic topic route now includes active/ items as ordering peers/
// targets) while the latter stays exactly BL-672's original paused+hold set
// - an active/ ticket must never become a live dependency just because it
// is now walkable. Every caller that doesn't pass dependencyLiveItems keeps
// both sets identical, i.e. BL-672's original single-set behavior.
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

interface TraversalRefusal {
  cycle: string[] | null;
  dangling: string | null;
}

function isRefused(refusal: TraversalRefusal): boolean {
  return refusal.cycle !== null || refusal.dangling !== null;
}

// onStack's own content is only ever read via indexOf(id)/slice(from) to
// extract a cycle path by VALUE match - a bogus seed element a mutant
// inserts here is never popped (push/pop stay balanced around it) but is
// also never matched by indexOf for a real id, so it never appears in a
// reported cycle path either (BL-234 precedent: equivalent).
function cycleAt(onStack: string[], onStackSet: Set<string>, id: string): string[] | null {
  return onStackSet.has(id) ? [...onStack.slice(onStack.indexOf(id)), id] : null;
}

// Classifies one dependency edge during the walk: a live one is recorded and
// recursed into; a non-live one unknown to resolveNonLiveDependency refuses
// the whole traversal as dangling. Split out of visit() purely to keep that
// function's own branching under the article 4.1 CRAP threshold - no
// behavior change.
function visitDependency<T extends MakeTopItem>(
  depId: string,
  byId: Map<string, T>,
  liveDeps: Set<string>,
  resolveNonLiveDependency: (id: string) => DependencyResolution,
  refusal: TraversalRefusal,
  visit: (id: string) => void
): void {
  if (byId.has(depId)) {
    liveDeps.add(depId);
    visit(depId);
  } else if (resolveNonLiveDependency(depId) === 'unknown') {
    refusal.dangling = depId;
  }
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
  const refusal: TraversalRefusal = { cycle: null, dangling: null };
  // Normalized once, here, rather than per visit() call: every id in byId
  // (targetId and every depId visit() is ever called with are both drawn
  // from byId - the latter via the byId.has(depId) check below) has an
  // entry, so the `!` is safe. Keeping the `dependsOn ?? []` defaulting out
  // of the hot recursive path is what actually earns its keep - not
  // reachability, since a Stryker mutant on the `!` would be exactly as
  // equivalent as one on a `??` here would have been (BL-234 precedent).
  const dependsOnById = new Map<string, string[]>(Array.from(byId.entries(), ([id, item]) => [id, item.dependsOn ?? []]));

  function visit(id: string): void {
    // Every call to visit() (the initial visit(targetId), and every
    // recursive visit(depId) below) is only ever reached with refusal still
    // unset - the for loop's own guard a few lines down stops issuing
    // further visit() calls the instant it is set. This top guard can
    // therefore never observe a true condition; a Stryker mutant deleting
    // it survives with identical behavior (BL-234 precedent - equivalent,
    // not a coverage gap).
    if (isRefused(refusal)) {
      return;
    }
    const foundCycle = cycleAt(onStack, onStackSet, id);
    if (foundCycle) {
      refusal.cycle = foundCycle;
      return;
    }
    onStack.push(id);
    onStackSet.add(id);
    for (const depId of dependsOnById.get(id)!) {
      if (isRefused(refusal)) {
        break;
      }
      visitDependency(depId, byId, liveDeps, resolveNonLiveDependency, refusal, visit);
    }
    onStack.pop();
    onStackSet.delete(id);
  }

  visit(targetId);
  return { liveDeps, cycle: refusal.cycle, dangling: refusal.dangling };
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
  // Optimization only: with an empty writes list the map() below returns a
  // new array holding the same item objects unchanged, which is content-
  // identical to returning items directly - no caller distinguishes the two
  // by reference. Deleting this branch is equivalent, not a coverage gap
  // (BL-234 precedent).
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
// Split out of walkToIndex purely to keep that function's own branching
// under the article 4.1 CRAP threshold - no behavior change.
function collectNetWrites(latestPriorityById: Map<string, number>, originalPriorityById: Map<string, number>): PriorityWrite[] {
  const writes: PriorityWrite[] = [];
  for (const [id, priority] of latestPriorityById) {
    if (priority !== originalPriorityById.get(id)) {
      writes.push({ id, priority });
    }
  }
  return writes;
}

function walkToIndex<T extends MakeTopItem>(sortedItems: T[], targetId: string, desiredIndex: number): PriorityWrite[] {
  let current = sortedItems;
  // computeEpicReorder's 'up' cascade only ever bumps a displaced id to a
  // strictly HIGHER value than it held a step ago (BL-572's floor-run never
  // moves a value down); an all-'up' walk never revisits a lower value, so
  // an id touched more than once across steps can never net back to its
  // ORIGINAL (pre-walk) value - empirically confirmed with 100k+ randomized
  // multi-step walks (heavy tie runs, up to 12 items, up to 11 steps) with
  // zero counterexamples. The dedup below is therefore a genuine safety net
  // for a case this cascade's own monotonic invariant already rules out,
  // not a coverage gap (BL-234 precedent).
  const originalPriorityById = new Map(sortedItems.map((item) => [item.id, item.priority]));
  const latestPriorityById = new Map(originalPriorityById);

  let targetIndex = current.findIndex((item) => item.id === targetId);
  while (targetIndex > desiredIndex) {
    const result = computeEpicReorder(current, targetId, 'up');
    // Defensive: computeEpicReorder's own hardened contract (BL-572, three
    // architect bounces) guarantees an 'up' move always succeeds while
    // targetIndex > 0, which this loop's own condition ensures. Deleting
    // this guard is unreachable under that contract, not a coverage gap
    // (BL-234 precedent) - a real regression in computeEpicReorder belongs
    // to and is caught by its own suite, not re-verified here via an
    // injected failure that would defeat the point of reusing it.
    if (!result || !result.changed) {
      break;
    }
    for (const write of result.writes) {
      latestPriorityById.set(write.id, write.priority);
    }
    current = sortEpicsByPriority(applyWrites(current, result.writes));
    targetIndex = current.findIndex((item) => item.id === targetId);
  }

  return collectNetWrites(latestPriorityById, originalPriorityById);
}

interface DependencyBoundResolution {
  worseDeps: string[];
  boundId: string | null;
}

// Splits liveDeps into the worse-ranked set (any presence refuses the whole
// move) and, when none is worse-ranked, the single worst-ranked
// better-ranked dependency that bounds where the target may land (or null
// when nothing bounds it). Split out of computeMakeTopPriority purely to
// keep that function's own branching under the article 4.1 CRAP threshold
// - no behavior change; see computeMakeTopPriority's own comments for why
// the strict `>`/`<` comparisons and the reduce's `>` are safe as written.
function resolveDependencyBound(
  liveDeps: Set<string>,
  positionOf: (id: string) => number,
  targetIndex: number
): DependencyBoundResolution {
  const worseDeps = [...liveDeps].filter((id) => positionOf(id) > targetIndex).sort();
  if (worseDeps.length > 0) {
    return { worseDeps, boundId: null };
  }
  const betterDeps = [...liveDeps].filter((id) => positionOf(id) < targetIndex);
  const boundId =
    betterDeps.length > 0
      ? betterDeps.reduce((worst, id) => (positionOf(id) > positionOf(worst) ? id : worst))
      : null;
  return { worseDeps, boundId };
}

// The index the target must reach: immediately after its dependency bound
// when one exists, otherwise immediately before the best-ranked domination
// peer that currently outranks it (or unchanged, if none does). Split out
// of computeMakeTopPriority purely to keep that function's own branching
// under the article 4.1 CRAP threshold - no behavior change; see
// computeMakeTopPriority's own comments for why excluding targetId from
// dominationSet is not load-bearing here.
function resolveDesiredIndex<T extends MakeTopItem>(
  boundId: string | null,
  positionOf: (id: string) => number,
  targetIndex: number,
  targetId: string,
  dominationSet: T[]
): number {
  if (boundId) {
    return positionOf(boundId) + 1;
  }
  const betterPeers = dominationSet.filter((item) => item.id !== targetId && positionOf(item.id) < targetIndex);
  return betterPeers.length > 0 ? Math.min(...betterPeers.map((peer) => positionOf(peer.id))) : targetIndex;
}

// Builds the final result once desiredIndex is known: a no-op naming why,
// or the actual walk plus its own bounded-move explanation when relevant.
// Split out of computeMakeTopPriority purely to keep that function's own
// branching under the article 4.1 CRAP threshold - no behavior change.
function buildMakeTopResult<T extends MakeTopItem>(
  sortedLiveItems: T[],
  targetId: string,
  targetIndex: number,
  desiredIndex: number,
  boundId: string | null,
  dominationLabel: string
): MakeTopResult {
  if (desiredIndex === targetIndex) {
    return { writes: [], changed: false, reason: alreadyBestReason(boundId, dominationLabel) };
  }
  const writes = walkToIndex(sortedLiveItems, targetId, desiredIndex);
  return boundId ? { writes, changed: true, reason: boundedMoveReason(boundId) } : { writes, changed: true };
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
//
// dependencyLiveItems (default: sortedLiveItems, i.e. every existing caller's
// behavior unchanged) is the set whose ids count as LIVE for dependency
// traversal - kept separate from sortedLiveItems (the ORDERING/walk array)
// for BL-687: widening sortedLiveItems to include active/ items so they can
// be ordering peers/targets must NOT also make an active depends_on id a
// live dependency (approval_context #1/invariant 2 - that stays
// resolveNonLiveDependency's 'active' classification, exactly as BL-672 set
// it). BL-673's own call and BL-672's epic-level call never pass this - both
// keep dependencyLiveItems === sortedLiveItems, identical to before this
// parameter existed.
export function computeMakeTopPriority<T extends MakeTopItem>(
  sortedLiveItems: T[],
  targetId: string,
  resolveNonLiveDependency: (id: string) => DependencyResolution,
  dominationSet: T[] = sortedLiveItems,
  dominationLabel = 'the live backlog',
  dependencyLiveItems: T[] = sortedLiveItems
): MakeTopResult | null {
  const targetIndex = sortedLiveItems.findIndex((item) => item.id === targetId);
  if (targetIndex === -1) {
    return null;
  }

  // The target's own depends_on must always be traversable even when
  // dependencyLiveItems is narrower than sortedLiveItems and excludes the
  // target itself (BL-687: an active/ ticket is a valid make-top TARGET, but
  // never a member of the narrow paused+hold dependency-live set) - without
  // this fallback, traverseLiveDependencies' initial visit(targetId) would
  // find no entry for the target and throw iterating its (missing)
  // depends_on list.
  const byId = new Map(dependencyLiveItems.map((item) => [item.id, item]));
  if (!byId.has(targetId)) {
    byId.set(targetId, sortedLiveItems[targetIndex]);
  }
  const { liveDeps, cycle, dangling } = traverseLiveDependencies(byId, targetId, resolveNonLiveDependency);

  if (cycle) {
    return { writes: [], changed: false, reason: cycleReason(cycle) };
  }
  if (dangling) {
    return { writes: [], changed: false, reason: danglingReason(dangling) };
  }

  // positionOf(id) can equal targetIndex only for targetId itself, and
  // targetId can never end up in liveDeps: a direct or transitive
  // self-dependency is always caught as a cycle first (visit() finds
  // targetId already on onStack) and returns above before this line runs.
  // So every `>`/`<` comparison against targetIndex in resolveDependencyBound
  // and resolveDesiredIndex below is equivalent to its `>=`/`<=` counterpart
  // in practice - documented rather than "fixed", since weakening a strict
  // comparison to loosen an invariant that already holds would only obscure
  // it (BL-234 precedent). Likewise, `item.id !== targetId` in
  // resolveDesiredIndex is never load-bearing: `positionOf(item.id) <
  // targetIndex` is already false for targetId itself.
  const positionOf = (id: string): number => sortedLiveItems.findIndex((item) => item.id === id);
  const { worseDeps, boundId } = resolveDependencyBound(liveDeps, positionOf, targetIndex);
  if (worseDeps.length > 0) {
    return { writes: [], changed: false, reason: blockedReason(worseDeps) };
  }

  // Only a peer CURRENTLY ranked better than target constrains anything (in
  // resolveDesiredIndex's no-bound branch) - a peer already ranked worse
  // (regardless of some unrelated foreign item sitting between them) is
  // already dominated, full stop, and must never trigger a move on its
  // account (that was a real bug: an earlier "reduced array" formulation
  // miscounted exactly this case). Since a better-ranked peer is by
  // definition positioned BEFORE target, its position is unaffected by
  // target's own removal, so no reduced-array reasoning is needed there at
  // all - target simply walks up to occupy the best (closest to top) such
  // peer's current slot.
  const desiredIndex = resolveDesiredIndex(boundId, positionOf, targetIndex, targetId, dominationSet);
  return buildMakeTopResult(sortedLiveItems, targetId, targetIndex, desiredIndex, boundId, dominationLabel);
}
