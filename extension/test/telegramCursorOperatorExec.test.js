const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  formatSyncenvReport,
  writeOperatorBounceSentinel,
  executeOperatorVerb,
  writeOperatorPauseState,
  readOperatorPauseState,
  tryAcquireEnsureLock,
  releaseEnsureLock,
  runOperatorStart,
} = require('../out/tools/telegramCursorOperatorExec');

test('BL-702: syncenv reports presence without values', () => {
  const root = mkTmpDir('bl702-syncenv-');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'swarm.env'),
    'export TELEGRAM_BOT_TOKEN=super-secret\nexport FOO=bar\n',
    'utf8'
  );
  const report = formatSyncenvReport(root);
  assert.match(report, /TELEGRAM_BOT_TOKEN: present/);
  assert.match(report, /FOO: present/);
  assert.doesNotMatch(report, /super-secret/);
  assert.doesNotMatch(report, /=bar/);
});

test('BL-702: restart writes bounce sentinel', () => {
  const root = mkTmpDir('bl702-restart-');
  const result = executeOperatorVerb(root, '/restart');
  assert.equal(result.wroteBounceSentinel, true);
  assert.equal(fs.readFileSync(path.join(root, '.swarmforge', 'bounce'), 'utf8'), 'swarm');
});

test('BL-702: bounce extension writes scoped sentinel', () => {
  const root = mkTmpDir('bl702-bounce-');
  writeOperatorBounceSentinel(root, 'extension');
  assert.equal(fs.readFileSync(path.join(root, '.swarmforge', 'bounce'), 'utf8'), 'extension');
});

test('BL-702: pause and resume write control-pause.json', () => {
  const root = mkTmpDir('bl702-pause-');
  const paused = executeOperatorVerb(root, '/pause');
  assert.match(paused.text, /pause:/);
  assert.equal(readOperatorPauseState(root).active, true);
  const resumed = executeOperatorVerb(root, '/resume');
  assert.match(resumed.text, /resume:/);
  assert.equal(readOperatorPauseState(root).active, false);
});

test('BL-702: start writes bounce sentinel for swarm.env relaunch', () => {
  const root = mkTmpDir('bl702-start-');
  const result = runOperatorStart(root);
  assert.match(result, /start:/);
  assert.equal(fs.readFileSync(path.join(root, '.swarmforge', 'bounce'), 'utf8'), 'swarm');
});

test('BL-702: stop runs kill_all_swarm.sh when present', () => {
  const root = mkTmpDir('bl702-stop-');
  const scriptDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  const marker = path.join(root, 'killed.marker');
  fs.writeFileSync(
    path.join(scriptDir, 'kill_all_swarm.sh'),
    `#!/usr/bin/env bash\necho ok > "${marker}"\nexit 0\n`,
    'utf8'
  );
  fs.chmodSync(path.join(scriptDir, 'kill_all_swarm.sh'), 0o755);
  const result = executeOperatorVerb(root, '/stop');
  assert.match(result.text, /stop: complete/);
  assert.equal(fs.readFileSync(marker, 'utf8').trim(), 'ok');
});

test('BL-702: ensure single-flight refuses overlapping acquire', () => {
  const root = mkTmpDir('bl702-ensure-lock-');
  assert.equal(tryAcquireEnsureLock(root, 1_000), true);
  assert.equal(tryAcquireEnsureLock(root, 1_100), false);
  releaseEnsureLock(root);
  assert.equal(tryAcquireEnsureLock(root, 1_200), true);
  releaseEnsureLock(root);
});

test('BL-702: writeOperatorPauseState round-trip', () => {
  const root = mkTmpDir('bl702-pause-rt-');
  writeOperatorPauseState(root, { active: true, untilMs: 99 });
  assert.deepEqual(readOperatorPauseState(root), { active: true, untilMs: 99 });
  writeOperatorPauseState(root, { active: false });
  assert.deepEqual(readOperatorPauseState(root), { active: false });
});

test('BL-703: autopilot dry and land dry via execute', () => {
  const root = mkTmpDir('bl703-dry-');
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  const auto = executeOperatorVerb(root, '/autopilot', 'dry');
  assert.match(auto.text, /autopilot dry/);
  const land = executeOperatorVerb(root, '/land', 'dry');
  assert.match(land.text, /land dry/);
});

test('BL-704: holiday/shift/oncall durable under operator/', () => {
  const root = mkTmpDir('bl704-policy-');
  const add = executeOperatorVerb(root, '/holiday', 'add 2099-06-01 2099-06-02 maint');
  assert.match(add.text, /holiday added/);
  const list = executeOperatorVerb(root, '/holiday', 'list');
  assert.match(list.text, /2099-06-01/);
  const shift = executeOperatorVerb(root, '/shift', 'start evening');
  assert.match(shift.text, /shift started: evening/);
  const status = executeOperatorVerb(root, '/shift', 'status');
  assert.match(status.text, /evening/);
  const oncall = executeOperatorVerb(root, '/oncall', 'me', { principalId: '777' });
  assert.match(oncall.text, /777/);
  const policyPath = path.join(root, '.swarmforge', 'operator', 'operator-policy.json');
  assert.ok(fs.existsSync(policyPath));
  const raw = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  assert.equal(raw.oncallId, '777');
  assert.ok(raw.shift);
});
