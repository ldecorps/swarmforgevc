'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assessPropertyGeneratorReach,
  isPropertyTestPath,
  PILOT_VACUOUS_PROPERTY_GENERATOR_REFUSAL,
} = require('../out/tools/propertyGeneratorReachCheck');
const { landPilotedTicket, checkPropertyGeneratorReach } = require('../out/tools/pilotAcceptanceGate');
const { makeAcceptanceGateDeps } = require('./helpers/pilotAcceptanceGateDeps');
const { mkTmpDir } = require('./helpers/tmpDir');

function mkRoot() {
  return mkTmpDir('bl739-unit-');
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

  // BL-1229: built on the shared, contract-checked base
  // (helpers/pilotAcceptanceGateDeps.js) - only this test's own overrides
  // are listed here now.
  const outcome = await landPilotedTicket('BL-739', makeAcceptanceGateDeps({
    checkCommitClaims: () => ({ checked: true, commitsChecked: 0 }),
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
    moveTicketToDone: () => {
      calls.move += 1;
      return { moved: true, destination: '/repo/backlog/done/BL-739.yaml' };
    },
    writeReceipt: () => {
      calls.receipt += 1;
    },
    getLandedCommit: () => 'a'.repeat(40),
    now: () => '2026-08-27T00:00:00.000Z',
  }));
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'vacuous-property-generator');
  assert.equal(calls.move, 0);
  assert.equal(calls.receipt, 0);
});
