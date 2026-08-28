'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  assessMultiBranchParserCoverage,
  UNTESTED_PARSER_BRANCH_REFUSAL,
} = require('../out/tools/multiBranchParserCoverageCheck');
const { landPilotedTicket } = require('../out/tools/pilotAcceptanceGate');

// BL-755 invariant 1: ≥3-arm parser with any untested arm refuses land
// (reasonKind untested-parser-branch). Invariant 3: no-op when none touched.
// Runs only via npm run test:properties.

const armWordArb = fc.stringMatching(/^[a-z][a-z0-9-]{2,10}$/);

function threeArmParser(a, b, c) {
  return {
    functionName: 'parse-flow',
    sourcePath: 'lib/parse.ts',
    arms: [
      { label: a, marker: a },
      { label: b, marker: b },
      { label: c, marker: c },
    ],
  };
}

function mkDeps(multiBranchOutcome) {
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
      checkMultiBranchParserCoverage: () => multiBranchOutcome,
      checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
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

test('property: any missing arm marker among ≥3 arms yields a miss', () => {
  fc.assert(
    fc.property(armWordArb, armWordArb, armWordArb, (a, b, c) => {
      fc.pre(a !== b && b !== c && a !== c);
      const result = assessMultiBranchParserCoverage({
        parsers: [threeArmParser(a, b, c)],
        testTexts: [a, b], // c missing
      });
      assert.equal(result.checked, true);
      assert.ok(result.miss);
      assert.equal(result.miss.armLabel, c);
    }),
    { numRuns: 40 }
  );
});

test('property: all three arm markers present never yields a miss', () => {
  fc.assert(
    fc.property(armWordArb, armWordArb, armWordArb, (a, b, c) => {
      fc.pre(a !== b && b !== c && a !== c);
      const result = assessMultiBranchParserCoverage({
        parsers: [threeArmParser(a, b, c)],
        testTexts: [`covers ${a}`, `covers ${b}`, `covers ${c}`],
      });
      assert.equal(result.miss, undefined);
    }),
    { numRuns: 40 }
  );
});

test('property: empty parser set is a no-op', () => {
  fc.assert(
    fc.property(armWordArb, (w) => {
      const result = assessMultiBranchParserCoverage({
        parsers: [],
        testTexts: [w],
      });
      assert.deepEqual(result, { checked: true, parsersScanned: 0 });
    }),
    { numRuns: 20 }
  );
});

test('property: land refuses untested-parser-branch inertly on miss', async () => {
  await fc.assert(
    fc.asyncProperty(armWordArb, async (arm) => {
      const { deps, calls } = mkDeps({
        checked: true,
        parsersScanned: 1,
        miss: { functionName: 'parse-flow', sourcePath: 'lib/parse.ts', armLabel: arm },
      });
      const outcome = await landPilotedTicket('BL-755', deps);
      assert.equal(outcome.landed, false);
      assert.equal(outcome.reasonKind, 'untested-parser-branch');
      assert.match(outcome.reason, new RegExp(UNTESTED_PARSER_BRANCH_REFUSAL));
      assert.equal(calls.move, 0);
      assert.equal(calls.receipt, 0);
    }),
    { numRuns: 25 }
  );
});

test('non-vacuity: missing-arm property would fail if assessor always returned no miss', () => {
  const broken = { checked: true, parsersScanned: 1 };
  const real = assessMultiBranchParserCoverage({
    parsers: [threeArmParser('alpha', 'beta', 'gamma')],
    testTexts: ['alpha', 'beta'],
  });
  assert.ok(real.miss);
  assert.notDeepEqual(broken, real);
});
