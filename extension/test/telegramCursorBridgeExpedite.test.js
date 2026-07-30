const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  parseExpediteTicket,
  parseReexpediteTicket,
  normalizeExpediteTicket,
  expediteScriptPath,
  reexpediteScriptPath,
  readExpediteLock,
  startExpediteRun,
  startReexpediteRun,
  formatExpediteStartMessage,
  formatReexpediteStartMessage,
  formatExpediteFailureMessage,
} = require('../out/tools/telegramCursorBridgeExpedite');

function mkRoot() {
  const root = mkTmpDir('sf-expedite-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

test('parseExpediteTicket accepts /expedite with optional ticket', () => {
  assert.equal(parseExpediteTicket('/expedite'), 'BL-696');
  assert.equal(parseExpediteTicket('/expedite BL-624'), 'BL-624');
  assert.equal(parseExpediteTicket('  /EXPEDITE bl-100  '), 'BL-100');
  assert.equal(parseExpediteTicket('/expedite NOPE'), undefined);
  assert.equal(parseExpediteTicket('ship it'), undefined);
});

test('parseReexpediteTicket accepts only /reexpedite with an optional ticket', () => {
  assert.equal(parseReexpediteTicket('/reexpedite'), 'BL-696');
  assert.equal(parseReexpediteTicket('/reexpedite BL-624'), 'BL-624');
  assert.equal(parseReexpediteTicket('  /REEXPEDITE bl-100  '), 'BL-100');
  assert.equal(parseReexpediteTicket('/reexpedite NOPE'), undefined);
  assert.equal(parseReexpediteTicket('/expedite BL-624'), undefined);
});

test('normalizeExpediteTicket validates BL ids', () => {
  assert.equal(normalizeExpediteTicket('bl-42'), 'BL-42');
  assert.equal(normalizeExpediteTicket('bad'), undefined);
});

test('startExpediteRun spawns detached script and writes lock', () => {
  const root = mkRoot();
  const script = expediteScriptPath(root);
  fs.writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(script, 0o755);
  const spawnCalls = [];
  const result = startExpediteRun(root, 'BL-696', (...args) => {
    spawnCalls.push(args);
    return { pid: process.pid, unref: () => {} };
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.ticket, 'BL-696');
    assert.equal(result.pid, process.pid);
    assert.match(result.logPath, /expedite-BL-696\.log$/);
    assert.match(formatExpediteStartMessage(result), /Expedite BL-696 started/);
  }
  assert.deepEqual(spawnCalls[0][0], 'bash');
  assert.deepEqual(spawnCalls[0][1], [script, root, 'BL-696']);
  const lock = readExpediteLock(root);
  assert.deepEqual(lock, { ticket: 'BL-696', pid: process.pid });
});

test('startExpediteRun rejects when script is missing', () => {
  const root = mkRoot();
  const result = startExpediteRun(root, 'BL-696');
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'missing-script');
    assert.match(formatExpediteFailureMessage(result), /not found/);
  }
});

test('startExpediteRun rejects when another expedite is running', () => {
  const root = mkRoot();
  const script = expediteScriptPath(root);
  fs.writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(script, 0o755);
  const lockPath = path.join(root, '.swarmforge', 'operator', 'expedite-bridge.lock');
  fs.writeFileSync(lockPath, `${JSON.stringify({ ticket: 'BL-111', pid: process.pid })}\n`, 'utf8');
  const result = startExpediteRun(root, 'BL-696', () => ({ pid: 1, unref: () => {} }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'already-running');
    assert.match(formatExpediteFailureMessage(result), /already running/i);
  }
});

test('startReexpediteRun spawns the WIP checkpoint restart script', () => {
  const root = mkRoot();
  const script = reexpediteScriptPath(root);
  fs.writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(script, 0o755);
  const spawnCalls = [];
  const result = startReexpediteRun(root, 'BL-696', (...args) => {
    spawnCalls.push(args);
    return { pid: process.pid, unref: () => {} };
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(formatReexpediteStartMessage(result), /checkpoint and restart for BL-696 started/i);
  }
  assert.deepEqual(spawnCalls[0][0], 'bash');
  assert.deepEqual(spawnCalls[0][1], [script, root, 'BL-696']);
});
