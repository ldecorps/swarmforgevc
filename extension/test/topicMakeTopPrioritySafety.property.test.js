const assert = require('node:assert/strict');
const fc = require('fast-check');
const { sortEpicsByPriority } = require('../out/bridge/epicReorderSafety');
const { computeMakeTopPriority } = require('../out/bridge/makeTopPrioritySafety');

// BL-654: computeMakeTopPriority's peer-scoped mode (BL-673) is exercised
// by its own ticket's three declared invariants
// (backlog/active/BL-673-topic-make-top-within-epic.yaml), restating
// BL-672's invariants 1/2 with "including pairs/dependencies in OTHER
// epics" made explicit. This file's generator therefore tags every item
// with an epic and lets depends_on edges cross epic boundaries freely (the
// candidate pool is NOT epic-scoped) - the case BL-672's own property test
// never had to reach at all. Independent reference traversal, same
// structure as makeTopPrioritySafety.property.test.js beside it. Runs ONLY
// via `npm run test:properties`.

const LIVE_ID_POOL = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4'];
const EPICS = ['EA', 'EB'];
const DONE_POOL = ['DONE-1', 'DONE-2'];
const ACTIVE_POOL = ['ACTIVE-1', 'ACTIVE-2'];
const GHOST_POOL = ['GHOST-1', 'GHOST-2'];

function resolveNonLive(id) {
  if (DONE_POOL.includes(id)) return 'done';
  if (ACTIVE_POOL.includes(id)) return 'active';
  return 'unknown';
}

const priorityArb = fc.integer({ min: 0, max: 3 });
const epicArb = fc.constantFrom(...EPICS);

const itemsArb = fc
  .integer({ min: 2, max: LIVE_ID_POOL.length })
  .chain((count) =>
    fc
      .tuple(
        fc.shuffledSubarray(LIVE_ID_POOL, { minLength: count, maxLength: count }),
        fc.array(priorityArb, { minLength: count, maxLength: count }),
        fc.array(epicArb, { minLength: count, maxLength: count })
      )
      .chain(([ids, priorities, epics]) => {
        const candidatePool = [...ids, ...DONE_POOL, ...ACTIVE_POOL, ...GHOST_POOL];
        const dependsOnArbs = ids.map((id) =>
          fc.subarray(
            candidatePool.filter((c) => c !== id),
            { maxLength: 2 }
          )
        );
        return fc
          .tuple(...dependsOnArbs)
          .map((depLists) => ids.map((id, i) => ({ id, priority: priorities[i], epic: epics[i], dependsOn: depLists[i] })));
      })
  );

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

function peersOf(sorted, epic, targetId) {
  return sorted.filter((i) => i.epic === epic && i.id !== targetId);
}

test('property: generator reaches both same-epic and cross-epic depends_on edges (reachability floor)', () => {
  let sameEpicDep = 0;
  let crossEpicDep = 0;
  let total = 0;
  fc.assert(
    fc.property(itemsArb, fc.nat(), (items, rawIndex) => {
      total += 1;
      const sorted = sortEpicsByPriority(items);
      const byId = new Map(sorted.map((i) => [i.id, i]));
      const targetId = pickTarget(sorted, rawIndex);
      const target = byId.get(targetId);
      for (const depId of target.dependsOn) {
        const dep = byId.get(depId);
        if (dep) {
          if (dep.epic === target.epic) sameEpicDep += 1;
          else crossEpicDep += 1;
        }
      }
    }),
    { numRuns: 400 }
  );
  assert.ok(sameEpicDep > 3, `expected some same-epic depends_on edges: ${sameEpicDep}/${total}`);
  assert.ok(crossEpicDep > 3, `expected some cross-epic depends_on edges: ${crossEpicDep}/${total}`);
});

test('property: invariant 1 - a peer-scoped apply never leaves the target outranking a live transitive dependency, same-epic or cross-epic', () => {
  fc.assert(
    fc.property(itemsArb, fc.nat(), (items, rawIndex) => {
      const sorted = sortEpicsByPriority(items);
      const byId = new Map(sorted.map((i) => [i.id, i]));
      const targetId = pickTarget(sorted, rawIndex);
      const target = byId.get(targetId);
      const { liveDeps, cycleDetected, danglingId } = referenceTraversal(byId, targetId);
      if (cycleDetected || danglingId) {
        return;
      }
      const peers = peersOf(sorted, target.epic, targetId);
      const result = computeMakeTopPriority(sorted, targetId, resolveNonLive, peers, `epic ${target.epic}'s live topics`);
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

test('property: invariant 2 - every pair of live items other than the target keeps its relative order, INCLUDING pairs in other epics', () => {
  fc.assert(
    fc.property(itemsArb, fc.nat(), (items, rawIndex) => {
      const sorted = sortEpicsByPriority(items);
      const targetId = pickTarget(sorted, rawIndex);
      const target = sorted.find((i) => i.id === targetId);
      const peers = peersOf(sorted, target.epic, targetId);
      const result = computeMakeTopPriority(sorted, targetId, resolveNonLive, peers, `epic ${target.epic}'s live topics`);
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

test('property: invariant 1 (peer-scoped domination) - a successful apply ranks the target before every live peer, unless bounded', () => {
  fc.assert(
    fc.property(itemsArb, fc.nat(), (items, rawIndex) => {
      const sorted = sortEpicsByPriority(items);
      const byId = new Map(sorted.map((i) => [i.id, i]));
      const targetId = pickTarget(sorted, rawIndex);
      const target = byId.get(targetId);
      const { cycleDetected, danglingId } = referenceTraversal(byId, targetId);
      if (cycleDetected || danglingId) {
        return;
      }
      const peers = peersOf(sorted, target.epic, targetId);
      const result = computeMakeTopPriority(sorted, targetId, resolveNonLive, peers, `epic ${target.epic}'s live topics`);
      if (!result || !result.changed || result.reason) {
        return; // a bounded success is exempt - it only has to beat peers ranked worse than the bound
      }
      const after = applyWrites(sorted, result.writes);
      const positionOf = (id) => after.findIndex((i) => i.id === id);
      const targetPos = positionOf(targetId);
      for (const peer of peers) {
        assert.ok(targetPos < positionOf(peer.id), `expected ${targetId} to rank before peer ${peer.id} when unbounded`);
      }
    }),
    { numRuns: 400 }
  );
});

// Invariant 3's "already in its best permitted slot" clause is a MINIMALITY
// requirement, not just a positional one - a peer-scoped apply must never
// perform a real move (changed:true) when the target ALREADY satisfies its
// own bound/domination requirement, even if walking further (e.g. all the
// way to the GLOBAL top) would still, incidentally, leave it ranked before
// every peer. This is computed via an INDEPENDENT reference ("alreadyBest"
// below never calls into computeMakeTopPriority's own decision logic), so
// it is a real oracle for exactly the over-eager-promotion bug class a
// naive peer-scoping generalization is prone to.
test('property: invariant 3 - a peer-scoped apply never reports changed:true when the target already satisfies its bound/domination requirement', () => {
  fc.assert(
    fc.property(itemsArb, fc.nat(), (items, rawIndex) => {
      const sorted = sortEpicsByPriority(items);
      const byId = new Map(sorted.map((i) => [i.id, i]));
      const targetId = pickTarget(sorted, rawIndex);
      const target = byId.get(targetId);
      const { liveDeps, cycleDetected, danglingId } = referenceTraversal(byId, targetId);
      if (cycleDetected || danglingId) {
        return;
      }
      const targetIndex = sorted.findIndex((i) => i.id === targetId);
      const positionOf = (id) => sorted.findIndex((i) => i.id === id);
      const worseDeps = [...liveDeps].filter((id) => positionOf(id) > targetIndex);
      if (worseDeps.length > 0) {
        return; // refusal case - not this property's concern
      }
      const betterDeps = [...liveDeps].filter((id) => positionOf(id) < targetIndex);
      const boundId =
        betterDeps.length > 0 ? betterDeps.reduce((worst, id) => (positionOf(id) > positionOf(worst) ? id : worst)) : null;

      const peers = peersOf(sorted, target.epic, targetId);
      const alreadyBest = boundId
        ? targetIndex === positionOf(boundId) + 1
        : peers.every((p) => positionOf(p.id) > targetIndex);

      if (!alreadyBest) {
        return;
      }
      const result = computeMakeTopPriority(sorted, targetId, resolveNonLive, peers, `epic ${target.epic}'s live topics`);
      assert.equal(result.changed, false, `expected a no-op: ${targetId} already satisfies its bound/domination requirement`);
    }),
    { numRuns: 400 }
  );
});
