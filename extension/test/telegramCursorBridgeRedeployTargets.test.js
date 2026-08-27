const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  parseFrontDeskRedeployCommand,
  startFrontDeskRedeployRun,
  formatFrontDeskRedeployStartMessage,
} = require('../out/tools/telegramCursorBridgeFrontDeskRedeploy');
const {
  parseAllRedeployCommand,
  startAllRedeployRun,
  formatAllRedeployStartMessage,
} = require('../out/tools/telegramCursorBridgeAllRedeploy');

function mkRoot() {
  const root = mkTmpDir('sf-redeploy-fd-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

test('parseFrontDeskRedeployCommand accepts frontdesk variants only', () => {
  assert.equal(parseFrontDeskRedeployCommand('/redeploy frontdesk'), true);
  assert.equal(parseFrontDeskRedeployCommand('/redeploy front-desk'), true);
  assert.equal(parseFrontDeskRedeployCommand('/redeploy front desk'), true);
  assert.equal(parseFrontDeskRedeployCommand('/redeploy'), false);
  assert.equal(parseFrontDeskRedeployCommand('/redeploy all'), false);
});

test('parseAllRedeployCommand accepts /redeploy all only', () => {
  assert.equal(parseAllRedeployCommand('/redeploy all'), true);
  assert.equal(parseAllRedeployCommand('/redeploy ALL'), true);
  assert.equal(parseAllRedeployCommand('/redeploy frontdesk'), false);
});

test('startFrontDeskRedeployRun spawns redeploy_front_desk.sh', () => {
  const root = mkRoot();
  const script = path.join(root, 'swarmforge', 'scripts', 'redeploy_front_desk.sh');
  fs.writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(script, 0o755);
  const spawnCalls = [];
  const result = startFrontDeskRedeployRun(root, (...args) => {
    spawnCalls.push(args);
    return { pid: 4242, unref: () => {} };
  });
  assert.equal(result.ok, true);
  assert.deepEqual(spawnCalls[0][1], [script, root]);
  assert.match(formatFrontDeskRedeployStartMessage(result), /Front desk redeploy started/);
  assert.match(formatFrontDeskRedeployStartMessage(result), /front desk/i);
});

test('startAllRedeployRun spawns redeploy_all_telegram.sh', () => {
  const root = mkRoot();
  const script = path.join(root, 'swarmforge', 'scripts', 'redeploy_all_telegram.sh');
  fs.writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(script, 0o755);
  const spawnCalls = [];
  const result = startAllRedeployRun(root, (...args) => {
    spawnCalls.push(args);
    return { pid: 5252, unref: () => {} };
  });
  assert.equal(result.ok, true);
  assert.deepEqual(spawnCalls[0][1][0], script);
  assert.match(formatAllRedeployStartMessage(result), /cursor bridge, front desk, mini app bridge/);
});
