'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assessPilotMkdtempConvention,
  isExtensionTestJsPath,
  PILOT_RAW_MKDTEMP_REFUSAL,
} = require('../out/tools/pilotMkdtempConventionCheck');
const { landPilotedTicket } = require('../out/tools/pilotAcceptanceGate');

test('isExtensionTestJsPath accepts extension test js and skips fixtures', () => {
  assert.equal(isExtensionTestJsPath('extension/test/foo.test.js'), true);
  assert.equal(isExtensionTestJsPath('extension/test/fixtures/foo.test.js'), false);
  assert.equal(isExtensionTestJsPath('extension/src/foo.js'), false);
});

test('assessPilotMkdtempConvention flags raw mkdtemp in touched test file', () => {
  const root = path.join(__dirname, '..', '..');
  const rel = `extension/test/bl743-assess-${process.pid}.test.js`;
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    "const fs = require('fs'); const os = require('os'); const path = require('path');\n" +
      "const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));\n",
    'utf8'
  );
  try {
    const outcome = assessPilotMkdtempConvention(root, [rel]);
    assert.equal(outcome.checked, true);
    assert.equal(outcome.violations.length, 1);
    assert.equal(outcome.violations[0].file, rel);
  } finally {
    fs.unlinkSync(abs);
  }
});

test('landPilotedTicket refuses raw-mkdtemp-outside-helper before move', async () => {
  const calls = { move: 0, receipt: 0 };
  let executedFeaturePath;
  const outcome = await landPilotedTicket('BL-743', {
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
    checkMkdtempConvention: () => ({
      checked: true,
      testFilesScanned: 1,
      violations: [{ file: 'extension/test/bad.test.js', line: 2 }],
      scannedPaths: ['extension/test/bad.test.js'],
    }),
    checkPropertyGeneratorReach: () => ({ checked: true, propertyFilesScanned: 0, scannedPaths: [] }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
    moveTicketToDone: () => {
      calls.move += 1;
      return { moved: true, destination: '/repo/backlog/done/BL-743.yaml' };
    },
    writeReceipt: () => {
      calls.receipt += 1;
    },
    getLandedCommit: () => 'a'.repeat(40),
    checkOriginMainLanding: () => ({ reachable: true }),
    now: () => '2026-08-26T00:00:00.000Z',
  });
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'raw-mkdtemp-outside-helper');
  assert.match(outcome.reason, new RegExp(PILOT_RAW_MKDTEMP_REFUSAL));
  assert.equal(outcome.mkdtempFile, 'extension/test/bad.test.js');
  assert.equal(calls.move, 0);
  assert.equal(calls.receipt, 0);
});
