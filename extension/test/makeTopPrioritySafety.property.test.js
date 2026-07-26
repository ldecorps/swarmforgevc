const assert = require('node:assert/strict');
const fc = require('fast-check');
const { sortEpicsByPriority } = require('../out/bridge/epicReorderSafety');
const { computeMakeTopPriority } = require('../out/bridge/makeTopPrioritySafety');

// BL-654: computeMakeTopPriority is a pure module
// (extension/src/bridge/makeTopPrioritySafety.ts) whose owning ticket
// (backlog/active/BL-672-epic-make-top-priority-button.yaml) declares three
// invariants. This file encodes invariants 1 and 2 (and the no-op half of
// invariant 3) as executable properties, coder-authored per the
// declared-invariant contract (BL-654), checked against an INDEPENDENT
// reference model (a separately-written traversal below, not a call into
// the implementation's own logic) so the property is a real oracle, not a
// restatement of the code under test. Runs ONLY via `npm run
// test:properties` (vitest.properties.config.mjs).

const LIVE_ID_POOL = ['E1', 'E2', 'E3', 'E4', 'T1', 'T2', 'T3', 'T4'];
const DONE_POOL = ['DONE-1', 'DONE-2'];
const ACTIVE_POOL = ['ACTIVE-1', 'ACTIVE-2'];
// Never resolvable anywhere - the dangling/unknown case.
const GHOST_POOL = ['GHOST-1', 'GHOST-2'];

function resolveNonLive(id) {
  if (DONE_POOL.includes(id)) return 'done';
  if (ACTIVE_POOL.includes(id)) return 'active';
  return 'unknown';
}

// Tiny domain so exact ties (a run at the priority floor - the case this
// ticket's own tie-run cascade exists for) are the common case, not a
// statistical accident (property-test generator must reach deep state).
const priorityArb = fc.integer({ min: 0, max: 3 });

const itemsArb = fc
  .integer({ min: 2, max: LIVE_ID_POOL.length })
  .chain((count) =>
    fc
      .tuple(
        fc.shuffledSubarray(LIVE_ID_POOL, { minLength: count, maxLength: count }),
        fc.array(priorityArb, { minLength: count, maxLength: count })
      )
      .chain(([ids, priorities]) => {
        const candidatePool = [...ids, ...DONE_POOL, ...ACTIVE_POOL, ...GHOST_POOL];
        const dependsOnArbs = ids.map((id) =>
          fc.subarray(
            candidatePool.filter((c) => c !== id),
            { maxLength: 2 }
          )
        );
        return fc
          .tuple(...dependsOnArbs)
          .map((depLists) => ids.map((id, i) => ({ id, priority: priorities[i], dependsOn: depLists[i] })));
      })
  );

// Independent reference traversal (iterative, path-tracked stack) -
// structurally different from the implementation's recursive
// onStack-Set walk, so a shared bug in "how to detect a cycle" is not
// silently invisible to both.
function referenceTraversal(byId, targetId) {
  const liveDeps = new Set();
  let cycleDetected = false;
  let danglingId = null;
  const stack = [[targetId, [targetId]]];
  let steps = 0;
  while (stack.length > 0 && steps < 2000) {
    steps += 1;
    const [id, pathSoFar] = stack.pop();
    const item = byId.get(id);
    for (const dep of item?.dependsOn ?? []) {
      if (pathSoFar.includes(dep)) {
        cycleDetected = true;
        continue;
      }
      if (byId.has(dep)) {
        liveDeps.add(dep);
        stack.push([dep, [...pathSoFar, dep]]);
      } else if (resolveNonLive(dep) === 'unknown') {
        danglingId = dep;
      }
    }
  }
  return { liveDeps, cycleDetected, danglingId };
}

function applyWrites(items, writes) {
  const byId = new Map(items.map((i) => [i.id, i.priority]));
  for (const w of writes) {
    byId.set(w.id, w.priority);
  }
  return sortEpicsByPriority(items.map((i) => ({ ...i, priority: byId.get(i.id) })));
}

function pickTarget(sorted, rawIndex) {
  return sorted[rawIndex % sorted.length].id;
}

test('property: generator reaches tied runs, refusal paths (cycle/dangling/blocked), and successful moves (reachability floor)', () => {
  let tied = 0;
  let cyclic = 0;
  let dangling = 0;
  let total = 0;
  fc.assert(
    fc.property(itemsArb, fc.nat(), (items, rawIndex) => {
      total += 1;
      const sorted = sortEpicsByPriority(items);
      const byId = new Map(sorted.map((i) => [i.id, i]));
      const targetId = pickTarget(sorted, rawIndex);
      const { cycleDetected, danglingId } = referenceTraversal(byId, targetId);
      if (cycleDetected) cyclic += 1;
      if (danglingId) dangling += 1;
      for (let i = 0; i + 1 < sorted.length; i++) {
        if (sorted[i].priority === sorted[i + 1].priority) {
          tied += 1;
          break;
        }
      }
    }),
    { numRuns: 400 }
  );
  assert.ok(tied > total * 0.2, `expected many generated backlogs to contain a tied run: ${tied}/${total}`);
  assert.ok(cyclic > 3, `expected the generator to reach some cyclic depends_on chains: ${cyclic}/${total}`);
  assert.ok(dangling > 3, `expected the generator to reach some dangling depends_on ids: ${dangling}/${total}`);
});

test('property: invariant 1 - a successful apply never leaves the target outranking a live transitive dependency', () => {
  fc.assert(
    fc.property(itemsArb, fc.nat(), (items, rawIndex) => {
      const sorted = sortEpicsByPriority(items);
      const byId = new Map(sorted.map((i) => [i.id, i]));
      const targetId = pickTarget(sorted, rawIndex);
      const { liveDeps, cycleDetected, danglingId } = referenceTraversal(byId, targetId);
      if (cycleDetected || danglingId) {
        return; // refusal paths - covered by the dedicated property below
      }
      const result = computeMakeTopPriority(sorted, targetId, resolveNonLive);
      if (!result || !result.changed) {
        return;
      }
      const after = applyWrites(sorted, result.writes);
      const positionOf = (id) => after.findIndex((i) => i.id === id);
      const targetPos = positionOf(targetId);
      for (const depId of liveDeps) {
        assert.ok(
          targetPos > positionOf(depId),
          `expected ${targetId} (pos ${targetPos}) to rank AFTER its live dependency ${depId} (pos ${positionOf(depId)})`
        );
      }
    }),
    { numRuns: 400 }
  );
});

test('property: invariant 2 - every pair of live items other than the target keeps its relative order', () => {
  fc.assert(
    fc.property(itemsArb, fc.nat(), (items, rawIndex) => {
      const sorted = sortEpicsByPriority(items);
      const targetId = pickTarget(sorted, rawIndex);
      const result = computeMakeTopPriority(sorted, targetId, resolveNonLive);
      if (!result || !result.changed) {
        return;
      }
      const after = applyWrites(sorted, result.writes);
      const beforeOthers = sorted.filter((i) => i.id !== targetId).map((i) => i.id);
      const afterOthers = after.filter((i) => i.id !== targetId).map((i) => i.id);
      assert.deepEqual(afterOthers, beforeOthers);
    }),
    { numRuns: 400 }
  );
});

test('property: invariant 3 (no-op half) - refusal and already-best-position cases never write and always state a reason', () => {
  fc.assert(
    fc.property(itemsArb, fc.nat(), (items, rawIndex) => {
      const sorted = sortEpicsByPriority(items);
      const byId = new Map(sorted.map((i) => [i.id, i]));
      const targetId = pickTarget(sorted, rawIndex);
      const targetIndex = sorted.findIndex((i) => i.id === targetId);
      const { liveDeps, cycleDetected, danglingId } = referenceTraversal(byId, targetId);
      const result = computeMakeTopPriority(sorted, targetId, resolveNonLive);
      assert.ok(result, 'target is always present in the live set here');

      const positionOf = (id) => sorted.findIndex((i) => i.id === id);
      const worseDeps = [...liveDeps].filter((id) => positionOf(id) > targetIndex);

      if (cycleDetected || danglingId || worseDeps.length > 0) {
        assert.equal(result.changed, false);
        assert.deepEqual(result.writes, []);
        assert.equal(typeof result.reason, 'string');
        assert.ok(result.reason.length > 0);
        return;
      }

      const betterDeps = [...liveDeps].filter((id) => positionOf(id) < targetIndex);
      const boundId =
        betterDeps.length > 0 ? betterDeps.reduce((worst, id) => (positionOf(id) > positionOf(worst) ? id : worst)) : null;
      const desiredIndex = boundId ? positionOf(boundId) + 1 : 0;

      if (desiredIndex === targetIndex) {
        assert.equal(result.changed, false);
        assert.deepEqual(result.writes, []);
        assert.equal(typeof result.reason, 'string');
        assert.ok(result.reason.length > 0);
      } else {
        assert.equal(result.changed, true);
      }
    }),
    { numRuns: 400 }
  );
});
