'use strict';

const assert = require('node:assert/strict');
const {
  assessPerHatRolePromptEvidence,
  verdictHasRolePromptEvidence,
  PILOT_HAT_PROMPT_MISSING_REFUSAL,
} = require('../out/tools/perHatRolePromptEvidenceCheck');
const { landPilotedTicket } = require('../out/tools/pilotAcceptanceGate');

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
      recordAcceptanceExecution: (p) => {
        executedFeaturePath = p;
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
      checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
      moveTicketToDone: () => {
        calls.move += 1;
        return { moved: true, destination: '/repo/backlog/done/x.yaml' };
      },
      writeReceipt: () => {
        calls.writeReceipt += 1;
      },
      getLandedCommit: () => 'a'.repeat(40),
      checkOriginMainLanding: () => ({ reachable: true }),
      now: () => '2026-08-26T00:00:00.000Z',
      ...overrides,
    },
    calls,
  };
}

const HASH = 'a'.repeat(64);

test('verdictHasRolePromptEvidence requires path and 64-hex hash', () => {
  assert.equal(
    verdictHasRolePromptEvidence({
      verdictPath: 'v.json',
      role_prompt_path: 'swarmforge/roles/coder.prompt',
      role_prompt_sha256: HASH,
    }),
    true
  );
  assert.equal(
    verdictHasRolePromptEvidence({
      verdictPath: 'v.json',
      role_prompt_path: 'swarmforge/roles/coder.prompt',
    }),
    false
  );
});

test('assessPerHatRolePromptEvidence refuses missing fields', () => {
  const result = assessPerHatRolePromptEvidence({
    verdicts: [
      {
        verdictPath: '.swarmforge/expedite/BL-758/01-coder/verdict.json',
        role: 'coder',
        role_prompt_path: 'swarmforge/roles/coder.prompt',
      },
    ],
  });
  assert.ok(result.miss);
  assert.equal(result.miss.role, 'coder');
});

test('assessPerHatRolePromptEvidence passes complete verdicts', () => {
  const result = assessPerHatRolePromptEvidence({
    verdicts: [
      {
        verdictPath: 'v.json',
        role: 'coder',
        role_prompt_path: 'swarmforge/roles/coder.prompt',
        role_prompt_sha256: HASH,
      },
    ],
  });
  assert.deepEqual(result, { checked: true, verdictsScanned: 1 });
});

test('assessPerHatRolePromptEvidence fails open when verdicts are undefined', () => {
  assert.deepEqual(assessPerHatRolePromptEvidence({ verdicts: undefined }), { checked: false });
});

test('assessPerHatRolePromptEvidence no-ops on empty verdict list', () => {
  assert.deepEqual(assessPerHatRolePromptEvidence({ verdicts: [] }), {
    checked: true,
    verdictsScanned: 0,
  });
});

test('verdictHasRolePromptEvidence rejects empty path and non-64-hex hash', () => {
  assert.equal(
    verdictHasRolePromptEvidence({
      verdictPath: 'v.json',
      role_prompt_path: '   ',
      role_prompt_sha256: HASH,
    }),
    false
  );
  assert.equal(
    verdictHasRolePromptEvidence({
      verdictPath: 'v.json',
      role_prompt_path: 'swarmforge/roles/coder.prompt',
      role_prompt_sha256: 'abc',
    }),
    false
  );
  assert.equal(
    verdictHasRolePromptEvidence({
      verdictPath: 'v.json',
      role_prompt_path: 'swarmforge/roles/coder.prompt',
      role_prompt_sha256: 'g'.repeat(64),
    }),
    false
  );
});

test('landPilotedTicket refuses pilot-hat-prompt-missing inertly', async () => {
  const { deps, calls } = mkDeps({
    checkPerHatRolePromptEvidence: () => ({
      checked: true,
      verdictsScanned: 1,
      miss: {
        verdictPath: '.swarmforge/expedite/BL-758/01-coder/verdict.json',
        role: 'coder',
      },
    }),
  });
  const outcome = await landPilotedTicket('BL-758', deps);
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'pilot-hat-prompt-missing');
  assert.match(outcome.reason, new RegExp(PILOT_HAT_PROMPT_MISSING_REFUSAL));
  assert.match(outcome.reason, /coder/);
  assert.equal(calls.move, 0);
  assert.equal(calls.writeReceipt, 0);
});
