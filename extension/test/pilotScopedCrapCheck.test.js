'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  assessPilotScopedCrap,
  isExtensionTsPath,
  PILOT_CRAP_VIOLATION_REFUSAL,
} = require('../out/tools/pilotScopedCrapCheck');
const { landPilotedTicket } = require('../out/tools/pilotAcceptanceGate');

test('isExtensionTsPath accepts extension ts and rejects other paths', () => {
  assert.equal(isExtensionTsPath('extension/src/foo.ts'), true);
  assert.equal(isExtensionTsPath('extension/src/foo.d.ts'), false);
  assert.equal(isExtensionTsPath('scripts/foo.ts'), false);
});

test('assessPilotScopedCrap returns checked false when coverage is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl741-cov-'));
  const rel = 'extension/src/missingCov.ts';
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'export function x(): void {}\n', 'utf8');
  const outcome = assessPilotScopedCrap(root, [rel]);
  assert.deepEqual(outcome, { checked: false });
});

test('landPilotedTicket refuses crap-violation before move', async () => {
  const calls = { move: 0, receipt: 0 };
  let executedFeaturePath;
  const outcome = await landPilotedTicket('BL-741', {
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
    checkScopedCrap: () => ({
      checked: true,
      tsFilesScanned: 1,
      violations: [{ file: 'extension/src/bad.ts', function: 'badFn', crap: 9 }],
    }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
    moveTicketToDone: () => {
      calls.move += 1;
      return { moved: true, destination: '/repo/backlog/done/BL-741.yaml' };
    },
    writeReceipt: () => {
      calls.receipt += 1;
    },
    getLandedCommit: () => 'a'.repeat(40),
    now: () => '2026-08-26T00:00:00.000Z',
  });
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'crap-violation');
  assert.match(outcome.reason, new RegExp(PILOT_CRAP_VIOLATION_REFUSAL));
  assert.equal(outcome.crapFile, 'extension/src/bad.ts');
  assert.equal(outcome.crapFunction, 'badFn');
  assert.equal(calls.move, 0);
  assert.equal(calls.receipt, 0);
});
