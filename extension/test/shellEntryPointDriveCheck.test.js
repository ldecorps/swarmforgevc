'use strict';

const assert = require('node:assert/strict');
const {
  assessShellEntryPointDrive,
  extractNamedEntryPoints,
  testInvokesEntryPoint,
  isShellTestPath,
  PARALLEL_SHELL_REIMPLEMENTATION_REFUSAL,
} = require('../out/tools/shellEntryPointDriveCheck');
const { landPilotedTicket } = require('../out/tools/pilotAcceptanceGate');

function mkDeps(overrides) {
  const calls = { move: 0, writeReceipt: 0 };
  let executedFeaturePath;
  const deps = {
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
    checkCommitClaims: () => ({ checked: true, commitsChecked: 1 }),
    checkCrossFileDuplication: () => ({ checked: true, filesScanned: 0 }),
    checkScopedCrap: () => ({ checked: true, tsFilesScanned: 0, violations: [] }),
    checkMkdtempConvention: () => ({ checked: true, testFilesScanned: 0, violations: [], scannedPaths: [] }),
    checkPropertyGeneratorReach: () => ({ checked: true, propertyFilesScanned: 0, scannedPaths: [] }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
    moveTicketToDone: () => {
      calls.move += 1;
      return { moved: true, destination: '/repo/backlog/done/BL-747-fixture.yaml' };
    },
    writeReceipt: () => {
      calls.writeReceipt += 1;
    },
    getLandedCommit: () => 'abc1234567',
    checkOriginMainLanding: () => ({ reachable: true }),
    now: () => '2026-08-26T00:00:00.000Z',
    ...overrides,
  };
  return { deps, calls };
}

test('extractNamedEntryPoints keeps stop-swarm.sh and drops scripts/test paths', () => {
  const yaml = `
description: |
  verifies stop-swarm.sh refuse gate
  also mentions swarmforge/scripts/test/test_lifecycle_script_scope.sh
required_wiring:
  - swarmforge/scripts/kill_pipeline_swarm.sh
`;
  assert.deepEqual(extractNamedEntryPoints(yaml), ['kill_pipeline_swarm.sh', 'stop-swarm.sh']);
});

test('testInvokesEntryPoint accepts bash path and ./name; rejects source-only', () => {
  assert.equal(
    testInvokesEntryPoint('bash "$ROOT/swarmforge/scripts/stop-swarm.sh" --full-stack\n', 'stop-swarm.sh'),
    true
  );
  assert.equal(testInvokesEntryPoint('./stop-swarm.sh --full-stack\n', 'stop-swarm.sh'), true);
  assert.equal(
    testInvokesEntryPoint('source "$ROOT/swarmforge/scripts/lib/stack_survivor_scan.sh"\n', 'stop-swarm.sh'),
    false
  );
  assert.equal(testInvokesEntryPoint('# stop-swarm.sh is under test\n', 'stop-swarm.sh'), false);
});

test('isShellTestPath only matches swarmforge/scripts/test/*.sh', () => {
  assert.equal(isShellTestPath('swarmforge/scripts/test/test_lifecycle_script_scope.sh'), true);
  assert.equal(isShellTestPath('swarmforge/scripts/stop-swarm.sh'), false);
});

test('assessShellEntryPointDrive refuses when named entry-point is never invoked', () => {
  const result = assessShellEntryPointDrive({
    ticketYaml: 'description: drives stop-swarm.sh\n',
    shellTests: [
      {
        path: 'swarmforge/scripts/test/test_lifecycle_script_scope.sh',
        text: 'source "$ROOT/swarmforge/scripts/lib/stack_survivor_scan.sh"\necho ok\n',
      },
    ],
  });
  assert.equal(result.checked, true);
  assert.ok(result.miss);
  assert.equal(result.miss.entryPoint, 'stop-swarm.sh');
});

test('assessShellEntryPointDrive fails open (checked false) when inputs are unreadable', () => {
  assert.deepEqual(assessShellEntryPointDrive({ ticketYaml: undefined, shellTests: [] }), {
    checked: false,
  });
  assert.deepEqual(assessShellEntryPointDrive({ ticketYaml: 'description: stop-swarm.sh\n', shellTests: undefined }), {
    checked: false,
  });
  assert.deepEqual(assessShellEntryPointDrive({ ticketYaml: undefined, shellTests: undefined }), {
    checked: false,
  });
});

test('assessShellEntryPointDrive is a no-op when no shell tests touched', () => {
  const result = assessShellEntryPointDrive({
    ticketYaml: 'description: drives stop-swarm.sh\n',
    shellTests: [],
  });
  assert.deepEqual(result, {
    checked: true,
    shellTestsScanned: 0,
    entryPointsNamed: 1,
  });
});

test('assessShellEntryPointDrive is a no-op when ticket names no entry-point', () => {
  const result = assessShellEntryPointDrive({
    ticketYaml: 'description: pure helper unit test\n',
    shellTests: [
      {
        path: 'swarmforge/scripts/test/test_helper.sh',
        text: 'source ./lib/foo.sh\n',
      },
    ],
  });
  assert.equal(result.entryPointsNamed, 0);
  assert.equal(result.miss, undefined);
});

test('landPilotedTicket refuses parallel-shell-reimplementation and writes nothing', async () => {
  const { deps, calls } = mkDeps({
    checkShellEntryPointDrive: () => ({
      checked: true,
      shellTestsScanned: 1,
      entryPointsNamed: 1,
      miss: {
        entryPoint: 'stop-swarm.sh',
        testPath: 'swarmforge/scripts/test/test_lifecycle_script_scope.sh',
      },
    }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
  });
  const outcome = await landPilotedTicket('BL-747', deps);
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'parallel-shell-reimplementation');
  assert.match(outcome.reason, /stop-swarm\.sh/);
  assert.match(outcome.reason, /test_lifecycle_script_scope\.sh/);
  assert.equal(calls.move, 0);
  assert.equal(calls.writeReceipt, 0);
  assert.match(PARALLEL_SHELL_REIMPLEMENTATION_REFUSAL, /entry-point/);
});

test('landPilotedTicket warns when shell drive history is unreadable', async () => {
  let receipt;
  const { deps, calls } = mkDeps({
    checkShellEntryPointDrive: () => ({ checked: false }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
    writeReceipt: (_id, r) => {
      calls.writeReceipt += 1;
      receipt = r;
    },
  });
  const outcome = await landPilotedTicket('BL-747', deps);
  assert.equal(outcome.landed, true);
  assert.ok(outcome.warnings?.some((w) => /shell entry-point drive was not checked/.test(w)));
  assert.equal(receipt.shellEntryPointDrive, undefined);
});
