'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isLifecycleTeardownTicket,
  assessMultiworktreeFixture,
  extractHandoffdRootsFromPs,
  MULTIWORKTREE_REQUIRED_REFUSAL,
} = require('../out/tools/multiworktreeAcceptanceFixture');

test('isLifecycleTeardownTicket is true when the acceptance path names lifecycle scripts', () => {
  assert.equal(
    isLifecycleTeardownTicket('specs/features/BL-637-lifecycle-script-names-lie-about-scope.feature', undefined),
    true
  );
});

test('isLifecycleTeardownTicket is true when required_wiring names a lifecycle shell script', () => {
  assert.equal(
    isLifecycleTeardownTicket('specs/features/fixture.feature', [
      'swarmforge/scripts/kill_pipeline_swarm.sh::survivor_scan::root scoped',
    ]),
    true
  );
});

test('isLifecycleTeardownTicket is false for ordinary feature tickets', () => {
  assert.equal(isLifecycleTeardownTicket('specs/features/BL-702-bubble.feature', undefined), false);
});

test('assessMultiworktreeFixture requires at least two worktrees and a sibling handoffd', () => {
  const pilot = '/repo/main';
  const sibling = '/repo/coder';
  const unsatisfied = assessMultiworktreeFixture(pilot, [pilot], [pilot]);
  assert.equal(unsatisfied.satisfied, false);

  const satisfied = assessMultiworktreeFixture(pilot, [pilot, sibling], [sibling]);
  assert.equal(satisfied.satisfied, true);
  assert.deepEqual(satisfied.metadata.siblingHandoffdRoots, [sibling]);
  assert.equal(satisfied.metadata.worktreeCount, 2);
});

test('extractHandoffdRootsFromPs ignores supervisor lines and collects sibling roots', () => {
  const ps = [
    'bb /repo/main/swarmforge/scripts/handoffd_supervisor.bb /repo/main',
    'bb /repo/coder/swarmforge/scripts/handoffd.bb /repo/coder',
    'bb /repo/main/swarmforge/scripts/handoffd.bb /repo/main',
  ].join('\n');
  assert.deepEqual(extractHandoffdRootsFromPs(ps).sort(), ['/repo/coder', '/repo/main'].sort());
});

test('MULTIWORKTREE_REQUIRED_REFUSAL names single-worktree-only insufficiency', () => {
  assert.match(MULTIWORKTREE_REQUIRED_REFUSAL, /single-worktree-only acceptance is insufficient/);
});
