const assert = require('node:assert/strict');
const { targetCloneDir, createRealContractPhaseAdapters } = require('../out/tools/contractPhaseRealAdapters');

// BL-624: contractPhaseRealAdapters.ts is the untested I/O boundary (real
// git/claude/node subprocess calls) - unit tests fake ContractPhaseAdapters
// entirely elsewhere (contractPhaseRelay.test.js,
// onboarderContractPhaseRouter.test.js), never invoking anything in this
// file. What IS worth a real test, without shelling out to anything, is the
// pure path-derivation helper (targetCloneDir - mirrors
// onboarderStateStore.ts's own slugifyTargetRepoUrl determinism guarantees,
// load-bearing for idempotent redelivery: a redelivered "proceed" must
// resolve to the SAME clone directory, not a fresh one) and the factory's
// own wiring (every adapter method the interface requires is actually
// present as a function - catches a renamed/dropped method without needing
// a live git/claude call).

test('BL-624: targetCloneDir is deterministic for the same target and swarm root', () => {
  const a = targetCloneDir('/swarm/root', 'https://github.com/acme/widget');
  const b = targetCloneDir('/swarm/root', 'https://github.com/acme/widget');
  assert.equal(a, b);
});

test('BL-624: targetCloneDir collapses scheme/.git aliases onto the same directory, mirroring slugifyTargetRepoUrl', () => {
  const canonical = targetCloneDir('/swarm/root', 'https://github.com/acme/widget');
  assert.equal(targetCloneDir('/swarm/root', 'https://github.com/acme/widget.git'), canonical);
  assert.equal(targetCloneDir('/swarm/root', 'git@github.com:acme/widget.git'.replace('git@github.com:', 'https://github.com/')), canonical);
});

test('BL-624: targetCloneDir distinguishes different targets and different swarm roots', () => {
  const widget = targetCloneDir('/swarm/root', 'https://github.com/acme/widget');
  const gadget = targetCloneDir('/swarm/root', 'https://github.com/acme/gadget');
  assert.notEqual(widget, gadget);
  const otherRoot = targetCloneDir('/other/root', 'https://github.com/acme/widget');
  assert.notEqual(widget, otherRoot);
});

test('BL-624: targetCloneDir nests under the swarm root\'s own .swarmforge/onboarding-clones, never the target-side .swarmforge', () => {
  const dir = targetCloneDir('/swarm/root', 'https://github.com/acme/widget');
  assert.match(dir, /^\/swarm\/root\/\.swarmforge\/onboarding-clones\//);
});

test('BL-624: createRealContractPhaseAdapters wires every ContractPhaseAdapters method as a function', () => {
  const adapters = createRealContractPhaseAdapters('/swarm/root');
  for (const method of ['cloneTarget', 'surveyRepo', 'proposeContract', 'readCurrentContract', 'negotiateObject', 'negotiateApprove', 'checkGate', 'commitAndPush']) {
    assert.equal(typeof adapters[method], 'function', `expected adapters.${method} to be a function`);
  }
});
