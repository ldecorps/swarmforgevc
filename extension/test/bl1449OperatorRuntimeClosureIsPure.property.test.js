const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { deriveOperatorRuntimeClosure } = require('../../specs/pipeline/steps/lib/operatorRuntimeBbFixtureFiles');

// BL-1449 invariant 1 (coder-authored, per the ticket's own Invariants
// obligation): "The exported list is a pure function of the tracked source
// tree ... no file name is typed into the module." This drives
// deriveOperatorRuntimeClosure against a RANDOMLY generated load-file graph
// written to a scratch mkdtemp tree (never the live one) and checks its
// output against an EXPECTED closure computed independently, by a plain BFS
// over the same edge data used to write the files - never by calling
// computeClosure/the module under test to build its own expected value,
// which would make the property vacuous (it would only prove the wrapper
// forwards its argument, not that the derivation tracks real load-file
// edges).
//
// Generator reach: 0-6 extra nodes beyond the fixed root
// (operator_runtime.bb), each independently assigned a random subset of ALL
// nodes (including itself and the root) as its load-file targets. This
// reliably produces, across the run count below: direct root dependencies,
// multi-hop chains (root -> A -> B, B not a direct root edge), unreachable
// nodes (unwritten edges strand a node the root never reaches), and
// self/cyclic edges (a node depending on itself or forming a cycle with an
// ancestor) - the last is deliberately exercised because computeClosure's
// Set-based visited tracking must treat a back-edge as a no-op, not an
// infinite loop, and generated graphs collide with that shape often enough
// to catch a regression there.
//
// Non-vacuity, checked by hand before landing: removed the `.sort()` in
// deriveOperatorRuntimeClosure - failed immediately on any generated graph
// with 2+ reachable nodes (order-dependent mismatch against the sorted
// expected value). Reverted and reconfirmed green.
//
// Runs ONLY via `npm run test:properties`; excluded from unit/coverage/
// mutation (BL-479's property-test separation). File IO only (mkdtemp),
// never the live swarmforge/scripts tree.

const NODE_NAME = fc.stringMatching(/^[a-z][a-z0-9_]{1,16}$/).map((s) => `${s}_lib.bb`);
const ROOT = 'operator_runtime.bb';

function loadFileLine(target) {
  return `(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "${target}")))`;
}

function reachableFrom(adjacency, root) {
  const visited = new Set([root]);
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift();
    for (const dep of adjacency.get(node) || []) {
      if (!visited.has(dep)) {
        visited.add(dep);
        queue.push(dep);
      }
    }
  }
  return visited;
}

const GRAPH = fc
  .uniqueArray(NODE_NAME, { minLength: 0, maxLength: 6 })
  .chain((others) => {
    const nodes = [ROOT, ...others];
    return fc.record({
      nodes: fc.constant(nodes),
      edges: fc.dictionary(fc.constantFrom(...nodes), fc.subarray(nodes)),
    });
  });

test('property: deriveOperatorRuntimeClosure equals an independently-computed BFS over the same load-file graph', () => {
  fc.assert(
    fc.property(GRAPH, ({ nodes, edges }) => {
      const root = mkTmpDir('sfvc-bl1449-prop-');
      try {
        const adjacency = new Map(nodes.map((n) => [n, edges[n] || []]));
        for (const node of nodes) {
          const body = (edges[node] || []).map(loadFileLine).join('\n');
          fs.writeFileSync(path.join(root, node), `${body}\n`);
        }
        const expected = [...reachableFrom(adjacency, ROOT)].sort();
        const actual = deriveOperatorRuntimeClosure(root);
        assert.deepEqual(actual, expected);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 200 }
  );
});
