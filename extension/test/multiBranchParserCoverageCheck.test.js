'use strict';

const assert = require('node:assert/strict');
const {
  assessMultiBranchParserCoverage,
  extractTsMultiArmParsers,
  extractCondParsers,
  UNTESTED_PARSER_BRANCH_REFUSAL,
} = require('../out/tools/multiBranchParserCoverageCheck');
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
      checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
      moveTicketToDone: () => {
        calls.move += 1;
        return { moved: true, destination: '/repo/backlog/done/BL-755.yaml' };
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

const THREE_ARM = {
  functionName: 'take-flow-reason',
  sourcePath: 'swarmforge/scripts/x.bb',
  arms: [
    { label: 'double-quoted', marker: 'double-quoted' },
    { label: 'single-quoted', marker: 'single-quoted' },
    { label: 'unquoted', marker: 'unquoted' },
  ],
};

test('extractTsMultiArmParsers finds ≥3 return arms', () => {
  const src = `
function parse(s) {
  if (s.startsWith('"')) return 'double-quoted';
  else if (s.startsWith("'")) return 'single-quoted';
  else return 'unquoted';
}
`;
  const parsers = extractTsMultiArmParsers(src, 'parse.ts');
  assert.equal(parsers.length, 1);
  assert.equal(parsers[0].functionName, 'parse');
  assert.ok(parsers[0].arms.length >= 3);
});

test('extractCondParsers finds ≥3 string-bodied cond arms', () => {
  const src = `
(defn take-flow-reason [s]
  (cond
    (re-find #"^\"" s) "double-quoted"
    (re-find #"^'" s) "single-quoted"
    :else "unquoted"))
`;
  const parsers = extractCondParsers(src, 'x.bb');
  assert.equal(parsers.length, 1);
  assert.equal(parsers[0].functionName, 'take-flow-reason');
  assert.ok(parsers[0].arms.length >= 3);
});

test('exactly three distinct arms meet MIN_PARSER_ARMS (threshold is >= not >)', () => {
  const condSrc = '(defn p [x] (cond (= x 1) "arm-a" (= x 2) "arm-b" :else "arm-c"))';
  const condParsers = extractCondParsers(condSrc, 'p.bb');
  assert.equal(condParsers.length, 1, 'cond with exactly 3 arms must be classified');
  assert.equal(condParsers[0].arms.length, 3);

  const tsSrc = `
function p(s) {
  if (s === 'a') return 'arm-a';
  else if (s === 'b') return 'arm-b';
  else return 'arm-c';
}
`;
  const tsParsers = extractTsMultiArmParsers(tsSrc, 'p.ts');
  assert.equal(tsParsers.length, 1, 'TS with exactly 3 return arms must be classified');
  assert.equal(tsParsers[0].arms.length, 3);
});

test('assessMultiBranchParserCoverage refuses when an arm is untested', () => {
  const result = assessMultiBranchParserCoverage({
    parsers: [THREE_ARM],
    testTexts: ['covers double-quoted only'],
  });
  assert.equal(result.checked, true);
  assert.ok(result.miss);
  assert.match(result.miss.armLabel, /single-quoted|unquoted/);
});

test('assessMultiBranchParserCoverage passes when every arm is exercised', () => {
  const result = assessMultiBranchParserCoverage({
    parsers: [THREE_ARM],
    testTexts: ['double-quoted', 'single-quoted case', 'unquoted path'],
  });
  assert.deepEqual(result, { checked: true, parsersScanned: 1 });
});

test('assessMultiBranchParserCoverage is a no-op with no multi-arm parsers', () => {
  const result = assessMultiBranchParserCoverage({ parsers: [], testTexts: [] });
  assert.deepEqual(result, { checked: true, parsersScanned: 0 });
});

test('assessMultiBranchParserCoverage fails open when parsers or testTexts are undefined', () => {
  assert.deepEqual(
    assessMultiBranchParserCoverage({ parsers: undefined, testTexts: [] }),
    { checked: false }
  );
  assert.deepEqual(
    assessMultiBranchParserCoverage({ parsers: [], testTexts: undefined }),
    { checked: false }
  );
});

test('assessMultiBranchParserCoverage filters out parsers below MIN_PARSER_ARMS', () => {
  const result = assessMultiBranchParserCoverage({
    parsers: [
      {
        functionName: 'two-arm',
        sourcePath: 'x.ts',
        arms: [
          { label: 'a', marker: 'a' },
          { label: 'b', marker: 'b' },
        ],
      },
    ],
    testTexts: [],
  });
  assert.deepEqual(result, { checked: true, parsersScanned: 0 });
});

test('landPilotedTicket refuses untested-parser-branch inertly', async () => {
  const { deps, calls } = mkDeps({
    checkMultiBranchParserCoverage: () => ({
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
      checked: true,
      parsersScanned: 1,
      miss: {
        functionName: 'take-flow-reason',
        sourcePath: 'x.bb',
        armLabel: 'single-quoted',
      },
    }),
  });
  const outcome = await landPilotedTicket('BL-755', deps);
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'untested-parser-branch');
  assert.match(outcome.reason, new RegExp(UNTESTED_PARSER_BRANCH_REFUSAL));
  assert.match(outcome.reason, /single-quoted/);
  assert.equal(calls.move, 0);
  assert.equal(calls.writeReceipt, 0);
});
