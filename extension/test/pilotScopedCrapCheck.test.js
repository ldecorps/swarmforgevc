'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assessPilotScopedCrap,
  isExtensionTsPath,
  PILOT_CRAP_VIOLATION_REFUSAL,
} = require('../out/tools/pilotScopedCrapCheck');
const { landPilotedTicket } = require('../out/tools/pilotAcceptanceGate');
const { mkTmpDir } = require('./helpers/tmpDir');
const { makeAcceptanceGateDeps } = require('./helpers/pilotAcceptanceGateDeps');

test('isExtensionTsPath accepts extension ts and rejects other paths', () => {
  assert.equal(isExtensionTsPath('extension/src/foo.ts'), true);
  assert.equal(isExtensionTsPath('extension/src/foo.d.ts'), false);
  assert.equal(isExtensionTsPath('scripts/foo.ts'), false);
});

test('isExtensionSrcTsPath accepts extension/src ts and rejects other paths', () => {
  const { isExtensionSrcTsPath } = require('../out/tools/pilotScopedCrapCheck');
  assert.equal(isExtensionSrcTsPath('extension/src/foo.ts'), true);
  assert.equal(isExtensionSrcTsPath('extension/scripts/foo.ts'), false);
  assert.equal(isExtensionSrcTsPath('extension/src/foo.d.ts'), false);
});

test('assessPilotScopedCrap returns empty scannedPaths when no extension ts was touched', () => {
  const root = mkTmpDir('bl745-empty-');
  const outcome = assessPilotScopedCrap(root, ['README.md', 'backlog/active/BL-745.yaml']);
  assert.deepEqual(outcome, { checked: true, tsFilesScanned: 0, violations: [], scannedPaths: [] });
});

test('assessPilotScopedCrap returns srcPathsInScope when coverage is missing', () => {
  const root = mkTmpDir('bl745-src-scope-');
  const rel = 'extension/src/missingCov.ts';
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'export function x(): void {}\n', 'utf8');
  const outcome = assessPilotScopedCrap(root, [rel]);
  assert.deepEqual(outcome, { checked: false, srcPathsInScope: [rel] });
});

// BL-1229: every landPilotedTicket call below is built on the shared,
// contract-checked base (helpers/pilotAcceptanceGateDeps.js) - only each
// test's own overrides are listed now.
test('landPilotedTicket writes scopedCrap evidence naming src paths on successful land', async () => {
  let receipt;
  const srcPath = 'extension/src/good.ts';
  const outcome = await landPilotedTicket('BL-745', makeAcceptanceGateDeps({
    checkCommitClaims: () => ({ checked: true, commitsChecked: 0 }),
    checkScopedCrap: () => ({
      checked: true,
      tsFilesScanned: 1,
      violations: [],
      scannedPaths: [srcPath],
    }),
    moveTicketToDone: () => ({ moved: true, destination: '/repo/backlog/done/BL-745.yaml' }),
    writeReceipt: (_ticketId, r) => {
      receipt = r;
    },
    getLandedCommit: () => 'b'.repeat(40),
    now: () => '2026-08-27T00:00:00.000Z',
  }));
  assert.equal(outcome.landed, true);
  assert.deepEqual(receipt.scopedCrap, {
    tsFilesScanned: 1,
    scannedPaths: [srcPath],
    outcome: 'passed',
  });
});

test('landPilotedTicket refuses missing CRAP evidence when extension/src was in scope', async () => {
  const calls = { move: 0, receipt: 0 };
  const outcome = await landPilotedTicket('BL-745', makeAcceptanceGateDeps({
    checkCommitClaims: () => ({ checked: true, commitsChecked: 0 }),
    checkScopedCrap: () => ({
      checked: true,
      tsFilesScanned: 1,
      violations: [],
      scannedPaths: [],
      srcPathsInScope: ['extension/src/omit.ts'],
    }),
    moveTicketToDone: () => {
      calls.move += 1;
      return { moved: true, destination: '/repo/backlog/done/BL-745.yaml' };
    },
    writeReceipt: () => {
      calls.receipt += 1;
    },
    getLandedCommit: () => 'c'.repeat(40),
    now: () => '2026-08-27T00:00:00.000Z',
  }));
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'crap-evidence-missing');
  assert.equal(calls.move, 0);
  assert.equal(calls.receipt, 0);
});

test('landPilotedTicket lands without scopedCrap evidence when only non-src extension ts was touched', async () => {
  let receipt;
  const outcome = await landPilotedTicket('BL-745', makeAcceptanceGateDeps({
    checkCommitClaims: () => ({ checked: true, commitsChecked: 0 }),
    checkScopedCrap: () => ({
      checked: true,
      tsFilesScanned: 1,
      violations: [],
      scannedPaths: ['extension/scripts/nonSrc.ts'],
    }),
    moveTicketToDone: () => ({ moved: true, destination: '/repo/backlog/done/BL-745.yaml' }),
    writeReceipt: (_ticketId, r) => {
      receipt = r;
    },
    getLandedCommit: () => 'd'.repeat(40),
    now: () => '2026-08-27T00:00:00.000Z',
  }));
  assert.equal(outcome.landed, true);
  assert.equal(receipt.scopedCrap, undefined);
});

test('landPilotedTicket refuses crap-violation before move', async () => {
  const calls = { move: 0, receipt: 0 };
  const outcome = await landPilotedTicket('BL-741', makeAcceptanceGateDeps({
    checkCommitClaims: () => ({ checked: true, commitsChecked: 0 }),
    checkScopedCrap: () => ({
      checked: true,
      tsFilesScanned: 1,
      violations: [{ file: 'extension/src/bad.ts', function: 'badFn', crap: 9 }],
      scannedPaths: ['extension/src/bad.ts'],
    }),
    moveTicketToDone: () => {
      calls.move += 1;
      return { moved: true, destination: '/repo/backlog/done/BL-741.yaml' };
    },
    writeReceipt: () => {
      calls.receipt += 1;
    },
    getLandedCommit: () => 'a'.repeat(40),
    now: () => '2026-08-26T00:00:00.000Z',
  }));
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'crap-violation');
  assert.match(outcome.reason, new RegExp(PILOT_CRAP_VIOLATION_REFUSAL));
  assert.equal(outcome.crapFile, 'extension/src/bad.ts');
  assert.equal(outcome.crapFunction, 'badFn');
  assert.equal(calls.move, 0);
  assert.equal(calls.receipt, 0);
});
