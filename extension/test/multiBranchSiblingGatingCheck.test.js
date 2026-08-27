'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  assessMultiBranchSiblingGating,
  extractCondGatingDispatches,
  extractGuardTokens,
  SIBLING_BRANCH_GATING_ASYMMETRY_REFUSAL,
} = require('../out/tools/multiBranchSiblingGatingCheck');
const { landPilotedTicket } = require('../out/tools/pilotAcceptanceGate');

const BL646_ASYMMETRIC = `
(defn assess-one-claim [cfg progress worktree-path]
  (let [severity (cond
                   (>= reclaims (:halt-threshold cfg)) :halt-imminent
                   (>= reclaims (:bounce-threshold cfg)) :critical
                   (>= reclaims default-warn-reclaims) :warn
                   (and head-unchanged? fixture-droppings?) :warn-fixture-droppings
                   (and head-unchanged?
                        (>= elapsed-pct 0.75)
                        (pos? untracked)) :warn-uncommitted
                   (and head-unchanged? (>= elapsed-pct 0.75)) :watch
                   :else :ok)]
    severity))
`;

const BL646_SYMMETRIC = `
(defn assess-one-claim [cfg progress worktree-path]
  (let [severity (cond
                   (>= reclaims (:halt-threshold cfg)) :halt-imminent
                   (>= reclaims (:bounce-threshold cfg)) :critical
                   (>= reclaims default-warn-reclaims) :warn
                   (and head-unchanged?
                        (>= elapsed-pct 0.75)
                        fixture-droppings?) :warn-fixture-droppings
                   (and head-unchanged?
                        (>= elapsed-pct 0.75)
                        (pos? untracked)) :warn-uncommitted
                   (and head-unchanged? (>= elapsed-pct 0.75)) :watch
                   :else :ok)]
    severity))
`;

function mkDeps(overrides) {
  const calls = { move: 0, writeReceipt: 0 };
  let executedFeaturePath;
  return {
    deps: {
      readAcceptanceDeclaration: () => 'specs/features/fixture.feature',
      resolveFeatureFilePath: () => '/repo/specs/features/fixture.feature',
      isLifecycleTeardownTicket: () => false,
      assessMultiworktreeFixture: () => ({
        satisfied: true,
        metadata: { worktreeCount: 1, siblingHandoffdRoots: [], pilotRoot: '/repo' },
      }),
      runAcceptance: async () => ({ success: true, output: 'ok' }),
      recordAcceptanceExecution: (featureFilePath) => {
        executedFeaturePath = featureFilePath;
      },
      readAcceptanceExecution: () => executedFeaturePath,
      checkCommitClaims: () => ({ checked: true, commitsChecked: 0 }),
      checkCrossFileDuplication: () => ({ checked: true, filesScanned: 0 }),
      checkScopedCrap: () => ({ checked: true, tsFilesScanned: 0, violations: [] }),
      checkMkdtempConvention: () => ({ checked: true, testFilesScanned: 0, violations: [], scannedPaths: [] }),
      checkPropertyGeneratorReach: () => ({ checked: true, propertyFilesScanned: 0, scannedPaths: [] }),
      checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
      checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
      checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
      checkMultiBranchSiblingGating: () => ({ checked: true, dispatchesScanned: 0 }),
      checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
      moveTicketToDone: () => {
        calls.move += 1;
        return { moved: true, destination: '/repo/backlog/done/BL-751.yaml' };
      },
      writeReceipt: () => {
        calls.writeReceipt += 1;
      },
      getLandedCommit: () => 'a'.repeat(40),
      now: () => '2026-08-27T00:00:00.000Z',
      ...overrides,
    },
    calls,
  };
}

const ASYMMETRIC_DISPATCH = {
  functionName: 'assess-one-claim',
  sourcePath: 'swarmforge/scripts/babysitter_assess_lib.bb',
  arms: [
    { label: 'halt-imminent', guards: ['(>= reclaims (:halt-threshold cfg))'] },
    { label: 'critical', guards: ['(>= reclaims (:bounce-threshold cfg))'] },
    { label: 'warn', guards: ['(>= reclaims default-warn-reclaims)'] },
    { label: 'warn-fixture-droppings', guards: ['head-unchanged?', 'fixture-droppings?'] },
    {
      label: 'warn-uncommitted',
      guards: ['head-unchanged?', '(>= elapsed-pct 0.75)', '(pos? untracked)'],
    },
    { label: 'watch', guards: ['head-unchanged?', '(>= elapsed-pct 0.75)'] },
  ],
};

test('extractGuardTokens captures predicate symbols and comparison guards', () => {
  const guards = extractGuardTokens('(and head-unchanged? (>= elapsed-pct 0.75) (pos? untracked))');
  assert.ok(guards.includes('head-unchanged?'));
  assert.ok(guards.includes('(>= elapsed-pct 0.75)'));
  assert.ok(guards.includes('(pos? untracked)'));
});

test('extractCondGatingDispatches finds BL-646 severity asymmetry', () => {
  const dispatches = extractCondGatingDispatches(BL646_ASYMMETRIC, 'babysitter_assess_lib.bb');
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].functionName, 'assess-one-claim');
  assert.ok(dispatches[0].arms.length >= 3);
});

test('assessMultiBranchSiblingGating refuses BL-646 missing grace gate', () => {
  const dispatches = extractCondGatingDispatches(BL646_ASYMMETRIC, 'babysitter_assess_lib.bb');
  const result = assessMultiBranchSiblingGating({ dispatches });
  assert.equal(result.checked, true);
  assert.ok(result.miss);
  assert.equal(result.miss.armLabel, 'warn-fixture-droppings');
  assert.match(result.miss.missingGuard, /elapsed-pct 0\.75/);
});

test('assessMultiBranchSiblingGating passes when sibling guards align', () => {
  const dispatches = extractCondGatingDispatches(BL646_SYMMETRIC, 'babysitter_assess_lib.bb');
  const result = assessMultiBranchSiblingGating({ dispatches });
  assert.equal(result.checked, true);
  assert.equal(result.miss, undefined);
});

test('assessMultiBranchSiblingGating is no-op with fewer than three predicate arms', () => {
  const result = assessMultiBranchSiblingGating({
    dispatches: [
      {
        functionName: 'small',
        sourcePath: 'x.bb',
        arms: [
          { label: 'a', guards: ['x?'] },
          { label: 'b', guards: ['y?'] },
        ],
      },
    ],
  });
  assert.equal(result.checked, true);
  assert.equal(result.dispatchesScanned, 0);
});

test('landPilotedTicket refuses sibling-branch gating asymmetry', async () => {
  const { deps } = mkDeps({
    checkMultiBranchSiblingGating: () => ({
      checked: true,
      dispatchesScanned: 1,
      miss: {
        functionName: ASYMMETRIC_DISPATCH.functionName,
        sourcePath: ASYMMETRIC_DISPATCH.sourcePath,
        armLabel: 'warn-fixture-droppings',
        missingGuard: '(>= elapsed-pct 0.75)',
      },
    }),
  });
  const outcome = await landPilotedTicket('BL-751', deps);
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'sibling-branch-gating-asymmetry');
  assert.match(outcome.reason, new RegExp(SIBLING_BRANCH_GATING_ASYMMETRY_REFUSAL));
  assert.match(outcome.reason, /warn-fixture-droppings/);
});

test('landPilotedTicket records dispatchesScanned on clean sibling gating', async () => {
  let receipt;
  const { deps } = mkDeps({
    checkMultiBranchSiblingGating: () => ({ checked: true, dispatchesScanned: 2 }),
    writeReceipt: (_id, r) => {
      receipt = r;
    },
  });
  const outcome = await landPilotedTicket('BL-751', deps);
  assert.equal(outcome.landed, true);
  assert.deepEqual(receipt.multiBranchSiblingGating, { dispatchesScanned: 2 });
});
