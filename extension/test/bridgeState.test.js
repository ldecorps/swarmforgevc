const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildBridgeState } = require('../out/bridge/bridgeState');
const { appendRun } = require('../out/runs/runLog');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bridge-state-'));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeRolesTsv(targetPath, roles) {
  mkdirp(path.join(targetPath, '.swarmforge'));
  const tsv = roles
    .map((r) => [r.role, 'session', r.worktreePath, `swarmforge-${r.role}`, r.displayName, 'claude', 'task'].join('\t'))
    .join('\n');
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), tsv + '\n');
}

function dropHandoff(worktreePath, subdir, filename, content) {
  const dir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', subdir);
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, filename), content);
}

function writeYaml(dir, filename, yaml) {
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, filename), yaml);
}

test('buildBridgeState projects pipeline stage per role from on-disk handoff inboxes', () => {
  const target = mkTmp();
  const coderWt = mkTmp();
  const cleanerWt = mkTmp();
  writeRolesTsv(target, [
    { role: 'coder', worktreePath: coderWt, displayName: 'Coder' },
    { role: 'cleaner', worktreePath: cleanerWt, displayName: 'Cleaner' },
  ]);
  dropHandoff(coderWt, 'new', '00_test.handoff', 'from: specifier\nto: coder\ntask: bl-999\ncommit: abc\n');

  const state = buildBridgeState(target, path.join(target, 'runs.jsonl'));

  assert.deepEqual(state.pipeline, [
    { role: 'coder', displayName: 'Coder', status: 'active' },
    { role: 'cleaner', displayName: 'Cleaner', status: 'idle' },
  ]);
});

test('buildBridgeState projects per-agent status and heartbeat when present', () => {
  const target = mkTmp();
  const coderWt = mkTmp();
  writeRolesTsv(target, [{ role: 'coder', worktreePath: coderWt, displayName: 'Coder' }]);
  const heartbeatDir = path.join(coderWt, '.swarmforge', 'heartbeat');
  mkdirp(heartbeatDir);
  fs.writeFileSync(
    path.join(heartbeatDir, 'coder.yaml'),
    'role: coder\npid: 4242\nlast_beat: "2026-07-02T13:00:00Z"\nlast_tool: Bash\nphase: exit\nin_flight: false\nbeat_count: 3\n'
  );

  const state = buildBridgeState(target, path.join(target, 'runs.jsonl'));

  assert.equal(state.agents.length, 1);
  assert.equal(state.agents[0].role, 'coder');
  assert.equal(state.agents[0].status, 'idle');
  assert.deepEqual(state.agents[0].heartbeat, {
    role: 'coder',
    pid: 4242,
    last_beat: '2026-07-02T13:00:00Z',
    last_tool: 'Bash',
    phase: 'exit',
    in_flight: false,
    beat_count: 3,
  });
});

test('buildBridgeState omits heartbeat for an agent with no heartbeat file yet', () => {
  const target = mkTmp();
  const coderWt = mkTmp();
  writeRolesTsv(target, [{ role: 'coder', worktreePath: coderWt, displayName: 'Coder' }]);

  const state = buildBridgeState(target, path.join(target, 'runs.jsonl'));

  assert.equal(Object.prototype.hasOwnProperty.call(state.agents[0], 'heartbeat'), false);
});

test('buildBridgeState projects backlog active/paused/done folders', () => {
  const target = mkTmp();
  writeYaml(path.join(target, 'backlog', 'active'), 'BL-001.yaml', 'id: BL-001\ntitle: active one\nstatus: todo\n');
  writeYaml(path.join(target, 'backlog', 'paused'), 'BL-002.yaml', 'id: BL-002\ntitle: paused one\nstatus: todo\n');
  writeYaml(path.join(target, 'backlog', 'done'), 'BL-003.yaml', 'id: BL-003\ntitle: done one\nstatus: done\n');

  const state = buildBridgeState(target, path.join(target, 'runs.jsonl'));

  assert.deepEqual(state.backlog.active, [{ id: 'BL-001', title: 'active one', status: 'todo' }]);
  assert.deepEqual(state.backlog.paused, [{ id: 'BL-002', title: 'paused one', status: 'todo' }]);
  assert.deepEqual(state.backlog.done, [{ id: 'BL-003', title: 'done one', status: 'done' }]);
});

test('buildBridgeState projects the run log', () => {
  const target = mkTmp();
  const runLogPath = path.join(target, 'runs.jsonl');
  appendRun(runLogPath, { name: 'run-1', targetPath: target, startedAt: '2026-07-02T12:00:00Z' });

  const state = buildBridgeState(target, runLogPath);

  assert.deepEqual(state.runLog, [{ name: 'run-1', targetPath: target, startedAt: '2026-07-02T12:00:00Z' }]);
});

test('buildBridgeState returns empty agents when roles.tsv is missing', () => {
  const target = mkTmp();

  const state = buildBridgeState(target, path.join(target, 'runs.jsonl'));

  assert.deepEqual(state.agents, []);
});
