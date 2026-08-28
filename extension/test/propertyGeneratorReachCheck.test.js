'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  assessPropertyGeneratorReach,
  isPropertyTestPath,
  PILOT_VACUOUS_PROPERTY_GENERATOR_REFUSAL,
} = require('../out/tools/propertyGeneratorReachCheck');
const { landPilotedTicket, checkPropertyGeneratorReach } = require('../out/tools/pilotAcceptanceGate');

function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bl739-unit-'));
}

function writeCore(root, boundary = 4096) {
  const rel = 'extension/src/tools/telegramCursorBridgeCore.ts';
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    `export const TELEGRAM_MESSAGE_MAX_LENGTH = ${boundary};\n` +
      'export function splitTelegramChunks(text: string, maxLen = TELEGRAM_MESSAGE_MAX_LENGTH) { return [text]; }\n',
    'utf8'
  );
}

function writeVacuousProperty(root, maxLength = 200) {
  const rel = 'extension/test/bl739-vacuous.property.test.js';
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    "const fc = require('fast-check');\n" +
      "const { splitTelegramChunks } = require('../out/tools/telegramCursorBridgeCore');\n" +
      `fc.property(fc.string({ maxLength: ${maxLength} }), (text) => splitTelegramChunks(text));\n`,
    'utf8'
  );
  return rel;
}

function writeReachingProperty(root) {
  const probeRel = 'extension/test/helpers/chunkingPropertyProbe.js';
  fs.mkdirSync(path.join(root, path.dirname(probeRel)), { recursive: true });
  fs.writeFileSync(
    path.join(root, probeRel),
    'const CHUNKING_PROPERTY_MAX_LEN = 50;\nmodule.exports = { CHUNKING_PROPERTY_MAX_LEN };\n',
    'utf8'
  );
  const rel = 'extension/test/bl739-reaching.property.test.js';
  fs.writeFileSync(
    path.join(root, rel),
    "const { splitTelegramChunks } = require('../out/tools/telegramCursorBridgeCore');\n" +
      "const { runChunkingProperty } = require('./helpers/chunkingPropertyProbe');\n" +
      'function runChunkingProperty() {}\n' +
      "fc.property(fc.string({ minLength: 51, maxLength: 200 }), (text) => splitTelegramChunks(text, 50));\n",
    'utf8'
  );
  return rel;
}

test('isPropertyTestPath accepts *.property.test.js only', () => {
  assert.equal(isPropertyTestPath('extension/test/foo.property.test.js'), true);
  assert.equal(isPropertyTestPath('extension/test/foo.test.js'), false);
});

test('assessPropertyGeneratorReach flags vacuous splitTelegramChunks generator', () => {
  const root = mkRoot();
  writeCore(root, 4096);
  const rel = writeVacuousProperty(root, 200);
  const outcome = assessPropertyGeneratorReach(root, [rel]);
  assert.equal(outcome.checked, true);
  assert.ok(outcome.miss);
  assert.equal(outcome.miss.generatorBound, 200);
  assert.equal(outcome.miss.functionBoundary, 4096);
});

test('assessPropertyGeneratorReach passes when generator crosses explicit boundary', () => {
  const root = mkRoot();
  writeCore(root, 4096);
  const rel = 'extension/test/bl739-explicit.property.test.js';
  fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(
    path.join(root, rel),
    "const fc = require('fast-check');\n" +
      "const { splitTelegramChunks } = require('../out/tools/telegramCursorBridgeCore');\n" +
      "fc.property(fc.string({ minLength: 51, maxLength: 200 }), (text) => splitTelegramChunks(text, 50));\n",
    'utf8'
  );
  const outcome = assessPropertyGeneratorReach(root, [rel]);
  assert.equal(outcome.checked, true);
  assert.equal(outcome.miss, undefined);
});

test('checkPropertyGeneratorReach refuses land before move', async () => {
  const calls = { move: 0, receipt: 0 };
  let executedFeaturePath;
  const refusal = checkPropertyGeneratorReach({
    checkPropertyGeneratorReach: () => ({
      checked: true,
      propertyFilesScanned: 1,
      miss: {
        propertyFile: 'extension/test/bad.property.test.js',
        targetFunction: 'splitTelegramChunks',
        generatorBound: 200,
        functionBoundary: 4096,
      },
      scannedPaths: ['extension/test/bad.property.test.js'],
    }),
  });
  assert.ok('refusal' in refusal);
  assert.equal(refusal.refusal.reasonKind, 'vacuous-property-generator');
  assert.match(refusal.refusal.reason, new RegExp(PILOT_VACUOUS_PROPERTY_GENERATOR_REFUSAL));

  const outcome = await landPilotedTicket('BL-739', {
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
    checkPropertyGeneratorReach: () => ({
      checked: true,
      propertyFilesScanned: 1,
      miss: {
        propertyFile: 'extension/test/bad.property.test.js',
        targetFunction: 'splitTelegramChunks',
        generatorBound: 200,
        functionBoundary: 4096,
      },
      scannedPaths: ['extension/test/bad.property.test.js'],
    }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
    moveTicketToDone: () => {
      calls.move += 1;
      return { moved: true, destination: '/repo/backlog/done/BL-739.yaml' };
    },
    writeReceipt: () => {
      calls.receipt += 1;
    },
    getLandedCommit: () => 'a'.repeat(40),
    checkOriginMainLanding: () => ({ reachable: true }),
    now: () => '2026-08-27T00:00:00.000Z',
  });
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'vacuous-property-generator');
  assert.equal(calls.move, 0);
  assert.equal(calls.receipt, 0);
});
