'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
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
