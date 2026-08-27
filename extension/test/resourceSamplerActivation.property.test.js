const assert = require('node:assert/strict');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { buildSampledRoles, selectAgentDescendant, DEFAULT_AGENT_COMMAND_NAME } = require('../out/swarm/resourceSamplerActivation');
const { sampleRolesOnce, readResourceSampleEvents } = require('../out/metrics/resourceTelemetry');

// BL-847 declared invariants (backlog/active/BL-847-resource-sampler-
// measures-pane-shell-not-agent-process.yaml):
// 1. A role's recorded rssBytes/cpuPercent describe the process actually
//    doing that role's work, not an ancestor shell that merely hosts it.
// 2. A role whose agent process cannot be identified records no sample at
//    all rather than a sample of the wrong process.
//
// Coder-authored property tests per BL-654; runs only via npm run test:properties.

const ROOT_PID = 1000;
const NON_AGENT_COMMANDS = ['bash', 'sh', 'zsh', 'node', 'python3'];
const OTHER_COMMANDS = [...NON_AGENT_COMMANDS, DEFAULT_AGENT_COMMAND_NAME];

// A random tree of descendant pids rooted at ROOT_PID: each node's parent is
// either ROOT_PID or an already-generated node (so every generated pid is
// genuinely reachable from ROOT_PID, at varying depth/branching) - no
// dangling/cyclic parents. pids are 2000+index so they never collide with
// ROOT_PID or the unrelated-subtree pids used below.
function genDescendantTree(nodeCount) {
  return fc
    .array(fc.nat({ max: 1_000_000 }), { minLength: nodeCount, maxLength: nodeCount })
    .chain((parentPicks) => {
      const nodes = [];
      for (let i = 0; i < nodeCount; i++) {
        const pid = 2000 + i;
        const priorPids = [ROOT_PID, ...nodes.map((n) => n.pid)];
        const ppid = priorPids[parentPicks[i] % priorPids.length];
        nodes.push({ pid, ppid });
      }
      return fc.constant(nodes);
    });
}

const TREE_SIZE_ARB = fc.integer({ min: 1, max: 8 });

function withCommands(nodes, commandArb) {
  return fc.tuple(...nodes.map(() => commandArb)).map((commands) => nodes.map((n, i) => ({ ...n, command: commands[i] })));
}

test('property: invariant 1 - the selected descendant is always the one carrying the configured agent command name, wherever in the subtree it sits', async () => {
  await fc.assert(
    fc.asyncProperty(
      TREE_SIZE_ARB.chain((n) => genDescendantTree(n)),
      fc.nat(),
      async (nodes, agentIndexPick) => {
        const nonAgentTreeArb = withCommands(nodes, fc.constantFrom(...NON_AGENT_COMMANDS));
        const [withNonAgentCommands] = fc.sample(nonAgentTreeArb, 1);
        const agentIndex = agentIndexPick % withNonAgentCommands.length;
        const tree = withNonAgentCommands.map((n, i) => (i === agentIndex ? { ...n, command: DEFAULT_AGENT_COMMAND_NAME } : n));
        const agentPid = tree[agentIndex].pid;

        const selected = selectAgentDescendant(tree, ROOT_PID, DEFAULT_AGENT_COMMAND_NAME);
        assert.equal(selected, agentPid, `expected the ${DEFAULT_AGENT_COMMAND_NAME}-labeled descendant (${agentPid}) to be selected, got ${selected}`);
      }
    ),
    { numRuns: 60 }
  );
});

test('property: invariant 1 wiring - the recorded rssBytes always matches stats for the resolved agent pid, never the root/shell pid', async () => {
  await fc.assert(
    fc.asyncProperty(
      TREE_SIZE_ARB.chain((n) => genDescendantTree(n)),
      fc.nat(),
      fc.integer({ min: 1, max: 1_000_000_000 }),
      async (nodes, agentIndexPick, agentRssBytes) => {
        const nonAgentTreeArb = withCommands(nodes, fc.constantFrom(...NON_AGENT_COMMANDS));
        const [withNonAgentCommands] = fc.sample(nonAgentTreeArb, 1);
        const agentIndex = agentIndexPick % withNonAgentCommands.length;
        const tree = withNonAgentCommands.map((n, i) => (i === agentIndex ? { ...n, command: DEFAULT_AGENT_COMMAND_NAME } : n));
        const agentPid = tree[agentIndex].pid;

        const root = mkTmpDir('sf-resource-sampler-prop1-');
        const roles = [{ role: 'coder', session: 'swarmforge-coder' }];
        const resolvePid = () => selectAgentDescendant(tree, ROOT_PID, DEFAULT_AGENT_COMMAND_NAME);
        const sampled = buildSampledRoles(root, roles, resolvePid);
        const getStats = (pid) => (pid === agentPid ? { rssBytes: agentRssBytes, cpuPercent: 1 } : { rssBytes: 128 * 1024, cpuPercent: 0 });

        sampleRolesOnce(root, sampled, getStats, 1751500000000);
        const events = readResourceSampleEvents(root);
        assert.equal(events.length, 1);
        assert.equal(events[0].rssBytes, agentRssBytes);
      }
    ),
    { numRuns: 40 }
  );
});

test('non-vacuity: invariant 1 property would fail against a broken selector that always returns the root pid', () => {
  const brokenSelection = ROOT_PID;
  const tree = [{ pid: 2000, ppid: ROOT_PID, command: DEFAULT_AGENT_COMMAND_NAME }];
  const realSelection = selectAgentDescendant(tree, ROOT_PID, DEFAULT_AGENT_COMMAND_NAME);
  assert.notEqual(brokenSelection, realSelection, 'expected the broken (root-pid-always) selection to disagree with the real invariant, proving the assertion is non-vacuous');
});

// ── invariant 2: no identifiable agent -> no sample, never a fallback ────

test('property: invariant 2 - when no descendant (anywhere reachable from the root, at any depth) carries the agent command name, no sample is ever recorded', async () => {
  await fc.assert(
    fc.asyncProperty(
      TREE_SIZE_ARB.chain((n) => genDescendantTree(n)),
      fc.integer({ min: 1, max: 5 }), // an unrelated subtree elsewhere in the process table
      async (nodes, unrelatedCount) => {
        const nonAgentTreeArb = withCommands(nodes, fc.constantFrom(...NON_AGENT_COMMANDS));
        const [reachableTree] = fc.sample(nonAgentTreeArb, 1);
        // An unrelated pid tree (parented off some OTHER root, e.g. pid 1)
        // that DOES carry the agent command name - proves selection never
        // wanders outside rootPid's own subtree to find a false match.
        const unrelatedTree = Array.from({ length: unrelatedCount }, (_, i) => ({
          pid: 5000 + i,
          ppid: i === 0 ? 1 : 5000 + i - 1,
          command: DEFAULT_AGENT_COMMAND_NAME,
        }));
        // The root's OWN entry (its pid, some other process's ppid) also
        // happens to carry the agent command name - must still not match,
        // since only DESCENDANTS are candidates, never the root itself.
        const fullTree = [...reachableTree, ...unrelatedTree, { pid: ROOT_PID, ppid: 1, command: DEFAULT_AGENT_COMMAND_NAME }];

        const root = mkTmpDir('sf-resource-sampler-prop2-');
        const roles = [{ role: 'coder', session: 'swarmforge-coder' }];
        const resolvePid = () => selectAgentDescendant(fullTree, ROOT_PID, DEFAULT_AGENT_COMMAND_NAME);
        const sampled = buildSampledRoles(root, roles, resolvePid);
        let statsCalled = false;
        const getStats = () => {
          statsCalled = true;
          return { rssBytes: 128 * 1024, cpuPercent: 0 };
        };

        const count = sampleRolesOnce(root, sampled, getStats, 1751500000000);
        const events = readResourceSampleEvents(root);
        assert.equal(count, 0);
        assert.equal(events.length, 0);
        assert.equal(statsCalled, false, 'expected getStats never to be invoked when no agent descendant is identified');
      }
    ),
    { numRuns: 60 }
  );
});

test('non-vacuity: invariant 2 property would fail against a broken implementation that falls back to the root pid when no agent is found', () => {
  const tree = [{ pid: 2000, ppid: ROOT_PID, command: 'bash' }];
  const realSelection = selectAgentDescendant(tree, ROOT_PID, DEFAULT_AGENT_COMMAND_NAME);
  const brokenFallbackSelection = ROOT_PID; // a broken implementation's fallback
  assert.notEqual(
    realSelection,
    brokenFallbackSelection,
    'expected the broken (falls-back-to-root) selection to disagree with the real invariant (null), proving the assertion is non-vacuous'
  );
});
