const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  parseLogCommand,
  resolveLogTarget,
  tailTextLines,
  truncateTelegramLog,
  formatLogTelegramMessage,
} = require('../out/tools/telegramCursorBridgeLogs');
const { expediteLogPath } = require('../out/tools/telegramCursorBridgeExpedite');

function mkRoot() {
  const root = mkTmpDir('sf-bridge-log-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

test('parseLogCommand accepts auto and named targets', () => {
  assert.deepEqual(parseLogCommand('/log'), { kind: 'auto' });
  assert.deepEqual(parseLogCommand('  /LOG  '), { kind: 'auto' });
  assert.deepEqual(parseLogCommand('/log redeploy'), { kind: 'redeploy' });
  assert.deepEqual(parseLogCommand('/log bridge'), { kind: 'bridge' });
  assert.deepEqual(parseLogCommand('/log expedite'), { kind: 'expedite', ticket: 'BL-696' });
  assert.deepEqual(parseLogCommand('/log expedite BL-624'), { kind: 'expedite', ticket: 'BL-624' });
  assert.equal(parseLogCommand('/log unknown'), undefined);
  assert.equal(parseLogCommand('/log expedite NOPE'), undefined);
});

test('resolveLogTarget auto prefers running expedite then redeploy', () => {
  assert.deepEqual(resolveLogTarget('/tmp', { kind: 'auto' }, { ticket: 'BL-696', pid: 1 }, undefined), {
    kind: 'expedite',
    ticket: 'BL-696',
  });
  assert.deepEqual(resolveLogTarget('/tmp', { kind: 'auto' }, undefined, { pid: 2 }), { kind: 'redeploy' });
  assert.deepEqual(resolveLogTarget('/tmp', { kind: 'auto' }, undefined, undefined), { kind: 'bridge' });
});

test('tailTextLines and truncateTelegramLog bound output size', () => {
  assert.equal(tailTextLines('a\nb\nc', 2), 'b\nc');
  assert.equal(truncateTelegramLog('abcdef', 4), '…def');
});

test('formatLogTelegramMessage returns tail in a fenced block', () => {
  const root = mkRoot();
  const logPath = expediteLogPath(root, 'BL-696');
  fs.writeFileSync(logPath, 'line one\nline two\n', 'utf8');
  const message = formatLogTelegramMessage(root, { kind: 'expedite', ticket: 'BL-696' }, 10, 200);
  assert.match(message, /Expedite BL-696 log/);
  assert.match(message, /line two/);
  assert.match(message, /```/);
});

test('formatLogTelegramMessage reports missing logs', () => {
  const root = mkRoot();
  const message = formatLogTelegramMessage(root, { kind: 'bridge' });
  assert.match(message, /empty or missing/i);
});
