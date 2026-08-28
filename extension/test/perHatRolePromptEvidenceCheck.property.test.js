'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  assessPerHatRolePromptEvidence,
  PILOT_HAT_PROMPT_MISSING_REFUSAL,
} = require('../out/tools/perHatRolePromptEvidenceCheck');
const { landPilotedTicket } = require('../out/tools/pilotAcceptanceGate');

// BL-758 invariant 3: completed stage verdicts require role_prompt_path +
// role_prompt_sha256 or land refuses pilot-hat-prompt-missing (inert).

const roleArb = fc.constantFrom('specifier', 'coder', 'cleaner', 'architect');
const hashArb = fc
  .array(fc.constantFrom(...'0123456789abcdef'.split('')), { minLength: 64, maxLength: 64 })
  .map((chars) => chars.join(''));

function mkDeps(outcome) {
  const calls = { move: 0, receipt: 0 };
  let executedFeaturePath;
  return {
    calls,
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
      checkPerHatRolePromptEvidence: () => outcome,
      moveTicketToDone: () => {
        calls.move += 1;
        return { moved: true, destination: '/repo/backlog/done/x.yaml' };
      },
      writeReceipt: () => {
        calls.receipt += 1;
      },
      getLandedCommit: () => 'a'.repeat(40),
      checkOriginMainLanding: () => ({ reachable: true }),
      now: () => '2026-08-26T00:00:00.000Z',
    },
  };
}

test('property: missing path or hash always yields a miss', () => {
  fc.assert(
    fc.property(roleArb, hashArb, fc.boolean(), (role, hash, omitHash) => {
      const verdict = {
        verdictPath: `01-${role}/verdict.json`,
        role,
        role_prompt_path: `swarmforge/roles/${role}.prompt`,
        role_prompt_sha256: omitHash ? undefined : hash,
      };
      if (!omitHash) {
        verdict.role_prompt_path = '';
      }
      const result = assessPerHatRolePromptEvidence({ verdicts: [verdict] });
      assert.ok(result.miss);
    }),
    { numRuns: 40 }
  );
});

test('property: complete path+hash never yields a miss', () => {
  fc.assert(
    fc.property(roleArb, hashArb, (role, hash) => {
      const result = assessPerHatRolePromptEvidence({
        verdicts: [
          {
            verdictPath: `01-${role}/verdict.json`,
            role,
            role_prompt_path: `swarmforge/roles/${role === 'qa' ? 'QA' : role}.prompt`,
            role_prompt_sha256: hash,
          },
        ],
      });
      assert.equal(result.miss, undefined);
    }),
    { numRuns: 40 }
  );
});

test('property: land refuses pilot-hat-prompt-missing inertly', async () => {
  await fc.assert(
    fc.asyncProperty(roleArb, async (role) => {
      const { deps, calls } = mkDeps({
        checked: true,
        verdictsScanned: 1,
        miss: { verdictPath: `01-${role}/verdict.json`, role },
      });
      const outcome = await landPilotedTicket('BL-758', deps);
      assert.equal(outcome.landed, false);
      assert.equal(outcome.reasonKind, 'pilot-hat-prompt-missing');
      assert.match(outcome.reason, new RegExp(PILOT_HAT_PROMPT_MISSING_REFUSAL));
      assert.equal(calls.move, 0);
      assert.equal(calls.receipt, 0);
    }),
    { numRuns: 20 }
  );
});

test('non-vacuity: missing-evidence property would fail if assessor always returned ok', () => {
  const broken = { checked: true, verdictsScanned: 1 };
  const real = assessPerHatRolePromptEvidence({
    verdicts: [{ verdictPath: 'v.json', role: 'coder' }],
  });
  assert.ok(real.miss);
  assert.notDeepEqual(broken, real);
});
