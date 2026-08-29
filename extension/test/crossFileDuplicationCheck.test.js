'use strict';

const assert = require('node:assert/strict');
const {
  findCrossFileDuplication,
  MIN_DUPLICATION_BLOCK_LINES,
  CROSS_FILE_DUPLICATION_REFUSAL,
} = require('../out/tools/crossFileDuplicationCheck');
const { landPilotedTicket } = require('../out/tools/pilotAcceptanceGate');

function helpBlock(label) {
  const lines = [];
  for (let i = 1; i <= MIN_DUPLICATION_BLOCK_LINES; i += 1) {
    lines.push(`# help line ${i} for ${label}`);
  }
  return lines.join('\n');
}

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
      return { moved: true, destination: '/repo/backlog/done/BL-737-fixture.yaml' };
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

test('findCrossFileDuplication refuses when the same block appears in more than two files', () => {
  const block = helpBlock('shared');
  const result = findCrossFileDuplication([
    { path: 'a.sh', text: `#!/bin/sh\n${block}\necho a\n` },
    { path: 'b.sh', text: `#!/bin/sh\n${block}\necho b\n` },
    { path: 'c.sh', text: `#!/bin/sh\n${block}\necho c\n` },
  ]);
  assert.equal(result.checked, true);
  assert.equal(result.filesScanned, 3);
  assert.ok(result.duplication);
  assert.equal(result.duplication.paths.length, 3);
  assert.deepEqual(result.duplication.paths, ['a.sh', 'b.sh', 'c.sh']);
});

test('findCrossFileDuplication does not refuse two-file duplication', () => {
  const block = helpBlock('pair');
  const result = findCrossFileDuplication([
    { path: 'a.sh', text: `#!/bin/sh\n${block}\n` },
    { path: 'b.sh', text: `#!/bin/sh\n${block}\n` },
  ]);
  assert.equal(result.checked, true);
  assert.equal(result.duplication, undefined);
});

test('findCrossFileDuplication ignores an identical block outside the provided file set', () => {
  const block = helpBlock('scoped');
  const result = findCrossFileDuplication([
    { path: 'touched-a.sh', text: `#!/bin/sh\n${block}\n` },
    { path: 'touched-b.sh', text: `#!/bin/sh\n${block}\n` },
  ]);
  assert.equal(result.duplication, undefined);
});

test('findCrossFileDuplication normalizes trailing whitespace before comparing', () => {
  const lines = [];
  for (let i = 1; i <= MIN_DUPLICATION_BLOCK_LINES; i += 1) {
    lines.push(`help ${i}`);
  }
  const base = lines.join('\n');
  const padded = lines.map((l) => `${l}   `).join('\n');
  const result = findCrossFileDuplication([
    { path: 'a.sh', text: base },
    { path: 'b.sh', text: padded },
    { path: 'c.sh', text: base },
  ]);
  assert.ok(result.duplication);
});

test('landPilotedTicket refuses cross-file duplication and writes nothing durable', async () => {
  const block = helpBlock('land');
  const { deps, calls } = mkDeps({
    checkCrossFileDuplication: () => ({
      checked: true,
      filesScanned: 3,
      duplication: { fingerprint: block, paths: ['a.sh', 'b.sh', 'c.sh'] },
    }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
  });
  const outcome = await landPilotedTicket('BL-737', deps);
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'cross-file-duplication');
  assert.match(outcome.reason, /a\.sh/);
  assert.match(outcome.reason, /b\.sh/);
  assert.deepEqual(outcome.duplicationPaths, ['a.sh', 'b.sh', 'c.sh']);
  assert.equal(calls.move, 0);
  assert.equal(calls.writeReceipt, 0);
  assert.match(CROSS_FILE_DUPLICATION_REFUSAL, /more than two/);
});

test('landPilotedTicket lands with a warning when touched-file history is unreadable', async () => {
  let receipt;
  const { deps, calls } = mkDeps({
    checkCrossFileDuplication: () => ({ checked: false }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
    writeReceipt: (_id, r) => {
      calls.writeReceipt += 1;
      receipt = r;
    },
  });
  const outcome = await landPilotedTicket('BL-737', deps);
  assert.equal(outcome.landed, true);
  assert.ok(outcome.warnings?.some((w) => /cross-file duplication was not checked/.test(w)));
  assert.equal(receipt.crossFileDuplicationFilesScanned, undefined);
});

test('landPilotedTicket records filesScanned on the receipt when duplication was checked clean', async () => {
  let receipt;
  const { deps } = mkDeps({
    checkCrossFileDuplication: () => ({ checked: true, filesScanned: 4 }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
    writeReceipt: (_id, r) => {
      receipt = r;
    },
  });
  const outcome = await landPilotedTicket('BL-737', deps);
  assert.equal(outcome.landed, true);
  assert.equal(receipt.crossFileDuplicationFilesScanned, 4);
});
