const assert = require('node:assert/strict');
const { test } = require('node:test');
const fc = require('fast-check');
const { landPilotedTicket } = require('../out/tools/pilotAcceptanceGate');
const { isExtensionSrcTsPath } = require('../out/tools/pilotScopedCrapCheck');

// BL-745 declared invariants (backlog/active/BL-745-bl718-pilot-missed-crap-gate.yaml):
// 1. Successful land touching extension/src/** TS leaves durable CRAP evidence naming scanned paths.
// 2. Src-touching land that would omit CRAP evidence refuses land and writes nothing durable.
// 3. Tickets that never touch extension/src/** are not refused solely for missing src CRAP evidence.

function buildDeps(crapOutcome, calls) {
  let executedFeaturePath;
  return {
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
    checkScopedCrap: () => crapOutcome,
    checkMkdtempConvention: () => ({ checked: true, testFilesScanned: 0, violations: [], scannedPaths: [] }),
    checkPropertyGeneratorReach: () => ({ checked: true, propertyFilesScanned: 0, scannedPaths: [] }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
    moveTicketToDone: () => {
      calls.move += 1;
      return { moved: true, destination: '/repo/backlog/done/BL-745-prop.yaml' };
    },
    writeReceipt: (_ticketId, receipt) => {
      calls.receipt += 1;
      calls.lastReceipt = receipt;
    },
    getLandedCommit: () => 'a'.repeat(40),
    checkOriginMainLanding: () => ({ reachable: true }),
    now: () => '2026-08-27T00:00:00.000Z',
  };
}

function srcPathsFromOutcome(outcome) {
  if (outcome.checked) {
    const fromScanned = (outcome.scannedPaths ?? []).filter(isExtensionSrcTsPath);
    if (fromScanned.length > 0) {
      return fromScanned;
    }
    return outcome.srcPathsInScope ?? [];
  }
  return outcome.srcPathsInScope ?? [];
}

function evidenceNamesAllSrcPaths(receipt, srcPaths) {
  if (!receipt || !receipt.scopedCrap) {
    return false;
  }
  const named = receipt.scopedCrap.scannedPaths.filter(isExtensionSrcTsPath);
  return srcPaths.every((p) => named.includes(p));
}

const pathArb = fc
  .tuple(fc.constantFrom('alpha', 'beta', 'gamma'), fc.integer({ min: 1, max: 99 }))
  .map(([name, n]) => `extension/src/${name}${n}.ts`);

test('property: invariant 1 - successful src-touching land records durable path-scoped CRAP evidence', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(pathArb, { minLength: 1, maxLength: 3 }), async (srcPaths) => {
      const unique = [...new Set(srcPaths)];
      const calls = { move: 0, receipt: 0 };
      const crapOutcome = {
        checked: true,
        tsFilesScanned: unique.length,
        violations: [],
        scannedPaths: unique,
      };
      const outcome = await landPilotedTicket('BL-745-PROP', buildDeps(crapOutcome, calls));
      assert.equal(outcome.landed, true);
      assert.ok(evidenceNamesAllSrcPaths(calls.lastReceipt, unique));
      assert.equal(calls.lastReceipt.scopedCrap.outcome, 'passed');
    }),
    { numRuns: 40 }
  );
});

test('property: invariant 2 - src-touching land with omitted evidence refuses and writes nothing durable', async () => {
  await fc.assert(
    fc.asyncProperty(pathArb, async (srcPath) => {
      const calls = { move: 0, receipt: 0 };
      const crapOutcome = {
        checked: true,
        tsFilesScanned: 1,
        violations: [],
        scannedPaths: [],
        srcPathsInScope: [srcPath],
      };
      const outcome = await landPilotedTicket('BL-745-PROP', buildDeps(crapOutcome, calls));
      assert.equal(outcome.landed, false);
      assert.equal(outcome.reasonKind, 'crap-evidence-missing');
      assert.equal(calls.move, 0);
      assert.equal(calls.receipt, 0);
    }),
    { numRuns: 40 }
  );
});

test('property: invariant 3 - non-src extension ts touch does not refuse solely for missing src CRAP evidence', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom('extension/scripts/x.ts', 'extension/test/helpers/x.ts'),
      async (nonSrcPath) => {
        const calls = { move: 0, receipt: 0 };
        const crapOutcome = {
          checked: true,
          tsFilesScanned: 1,
          violations: [],
          scannedPaths: [nonSrcPath],
        };
        const outcome = await landPilotedTicket('BL-745-PROP', buildDeps(crapOutcome, calls));
        assert.equal(outcome.landed, true);
        assert.notEqual(outcome.reasonKind, 'crap-evidence-missing');
        assert.equal(calls.lastReceipt.scopedCrap, undefined);
        assert.equal(srcPathsFromOutcome(crapOutcome).length, 0);
      }
    ),
    { numRuns: 20 }
  );
});
