const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseRedeployCommand,
  redeployScriptPath,
  readRedeployLock,
  startRedeployRun,
  formatRedeployStartMessage,
  formatRedeployFailureMessage,
} = require('../out/tools/telegramCursorBridgeRedeploy');

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-redeploy-'));
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

test('parseRedeployCommand accepts /redeploy only', () => {
  assert.equal(parseRedeployCommand('/redeploy'), true);
  assert.equal(parseRedeployCommand('  /REDEPLOY  '), true);
  assert.equal(parseRedeployCommand('/redeploy now'), false);
  assert.equal(parseRedeployCommand('/expedite'), false);
});

test('startRedeployRun spawns detached script and writes lock', () => {
  const root = mkRoot();
  const script = redeployScriptPath(root);
  fs.writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(script, 0o755);
  const spawnCalls = [];
  const result = startRedeployRun(root, (...args) => {
    spawnCalls.push(args);
    return { pid: process.pid, unref: () => {} };
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.pid, process.pid);
    assert.match(result.logPath, /redeploy-cursor-bridge\.log$/);
    assert.match(formatRedeployStartMessage(result), /Redeploy started/);
  }
  assert.deepEqual(spawnCalls[0][1], [script, root]);
  assert.deepEqual(readRedeployLock(root), { pid: process.pid });
});

test('startRedeployRun rejects when script is missing', () => {
  const root = mkRoot();
  const result = startRedeployRun(root);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'missing-script');
    assert.match(formatRedeployFailureMessage(result), /not found/);
  }
});

test('startRedeployRun rejects when another redeploy is running', () => {
  const root = mkRoot();
  const script = redeployScriptPath(root);
  fs.writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(script, 0o755);
  const lockPath = path.join(root, '.swarmforge', 'operator', 'redeploy-bridge.lock');
  fs.writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid })}\n`, 'utf8');
  const result = startRedeployRun(root, () => ({ pid: 1, unref: () => {} }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'already-running');
    assert.match(formatRedeployFailureMessage(result), /already running/i);
  }
});
