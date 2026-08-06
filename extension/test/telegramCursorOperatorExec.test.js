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
const { availabilityLedgerFileForMonth } = require('../out/metrics/availabilityLedgerStore');

function readLedgerLines(root) {
  const month = new Date().toISOString().slice(0, 7);
  const filePath = availabilityLedgerFileForMonth(root, month);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

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

// ── BL-823: writeOperatorPauseState also appends to the availability ledger ─

test('BL-823: /pause and /resume via executeOperatorVerb each append their own control-pause record naming source', () => {
  const root = mkTmpDir('bl823-operator-pause-');
  executeOperatorVerb(root, '/pause');
  executeOperatorVerb(root, '/resume');
  const lines = readLedgerLines(root);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].event, 'pause-start');
  assert.equal(lines[0].class, 'control-pause');
  assert.equal(lines[0].source, 'telegramCursorOperatorExec:pause');
  assert.equal(lines[1].event, 'pause-end');
  assert.equal(lines[1].source, 'telegramCursorOperatorExec:resume');
});

test('BL-823: writeOperatorPauseState appends a record naming an explicit source', () => {
  const root = mkTmpDir('bl823-operator-pause-source-');
  writeOperatorPauseState(root, { active: true, untilMs: 99 }, 'explicit-source');
  const [record] = readLedgerLines(root);
  assert.equal(record.source, 'explicit-source');
});

// BL-823: a caller that omits the source argument entirely still records a
// real, named source - never a blank or undefined one - so the ledger
// never carries an unattributable record. Twin of the same-named test in
// telegramFrontDeskBotCli.test.js for writeControlPauseState.
test('BL-823: writeOperatorPauseState with no source argument records the function-name default', () => {
  const root = mkTmpDir('bl823-operator-pause-default-source-');
  writeOperatorPauseState(root, { active: true, untilMs: 99 });
  const [record] = readLedgerLines(root);
  assert.equal(record.source, 'writeOperatorPauseState');
});

// BL-823 scenario 05 (control pause, operator side): a ledger write failure
// never blocks the operator pause state write it observes.
test('BL-823: a ledger write failure never blocks writeOperatorPauseState from completing', () => {
  const root = mkTmpDir('bl823-operator-pause-eisdir-');
  const month = new Date().toISOString().slice(0, 7);
  fs.mkdirSync(availabilityLedgerFileForMonth(root, month), { recursive: true });
  assert.doesNotThrow(() => {
    writeOperatorPauseState(root, { active: true, untilMs: 99 });
  });
  assert.deepEqual(readOperatorPauseState(root), { active: true, untilMs: 99 });
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

test('BL-698: hold and reinstate via execute', () => {
  const root = mkTmpDir('bl698-hold-');
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backlog', 'paused', 'BL-697.yaml'),
    'id: BL-697\ntitle: t\nstatus: todo\n',
    'utf8'
  );
  const held = executeOperatorVerb(root, '/hold', 'BL-697');
  assert.match(held.text, /parked under backlog\/hold/);
  assert.ok(fs.existsSync(path.join(root, 'backlog', 'hold', 'BL-697.yaml')));
  const back = executeOperatorVerb(root, '/reinstate', 'BL-697');
  assert.match(back.text, /restored to backlog\/paused/);
});

test('BL-698: ambulance engage and release via execute', () => {
  const root = mkTmpDir('bl698-amb-');
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backlog', 'paused', 'BL-698.yaml'),
    'id: BL-698\ntitle: t\nstatus: todo\n',
    'utf8'
  );
  const on = executeOperatorVerb(root, '/ambulance', 'BL-698');
  assert.match(on.text, /Ambulance engaged for BL-698/);
  const marker = path.join(root, '.swarmforge', 'operator', 'control-ambulance.json');
  assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).ticket, 'BL-698');
  const off = executeOperatorVerb(root, '/ambulance', 'off');
  assert.match(off.text, /Ambulance released/);
});

test('BL-698: kill-all and drain-swarm execute paths', () => {
  const root = mkTmpDir('bl698-kill-');
  const scriptDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  const marker = path.join(root, 'killed.marker');
  fs.writeFileSync(
    path.join(scriptDir, 'kill_all_swarm.sh'),
    `#!/usr/bin/env bash\necho ok > "${marker}"\nexit 0\n`,
    'utf8'
  );
  fs.chmodSync(path.join(scriptDir, 'kill_all_swarm.sh'), 0o755);
  const kill = executeOperatorVerb(root, '/kill-all');
  assert.match(kill.text, /kill-all:/);
  assert.equal(fs.readFileSync(marker, 'utf8').trim(), 'ok');
  const drain = executeOperatorVerb(root, '/drain-swarm');
  assert.match(drain.text, /drain-swarm:/);
});

test('BL-698: drain-agents reports when no socket', () => {
  const root = mkTmpDir('bl698-agents-');
  const result = executeOperatorVerb(root, '/drain-agents');
  assert.match(result.text, /drain-agents:/);
});
