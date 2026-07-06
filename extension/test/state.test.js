const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readHandoffInboxStatus, parseRolesTsv, currentStageLabel, readPipelineStages } = require('../out/swarm/swarmState');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-test-'));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

test('readHandoffInboxStatus returns idle when no inbox exists', () => {
  const tmp = mkTmp();
  assert.equal(readHandoffInboxStatus(tmp), 'idle');
});

test('readHandoffInboxStatus returns active when handoff in inbox/new', () => {
  const tmp = mkTmp();
  const newDir = path.join(tmp, '.swarmforge', 'handoffs', 'inbox', 'new');
  mkdirp(newDir);
  fs.writeFileSync(path.join(newDir, '50_test.handoff'), 'from: coder\nto: cleaner\n');
  assert.equal(readHandoffInboxStatus(tmp), 'active');
});

test('readHandoffInboxStatus returns active when handoff in inbox/in_process batch subdir', () => {
  const tmp = mkTmp();
  const batchDir = path.join(tmp, '.swarmforge', 'handoffs', 'inbox', 'in_process', 'batch_001');
  mkdirp(batchDir);
  fs.writeFileSync(path.join(batchDir, '50_test.handoff'), 'from: coder\nto: cleaner\n');
  assert.equal(readHandoffInboxStatus(tmp), 'active');
});

test('readHandoffInboxStatus returns idle when inbox dirs exist but are empty', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge', 'handoffs', 'inbox', 'new'));
  mkdirp(path.join(tmp, '.swarmforge', 'handoffs', 'inbox', 'in_process'));
  assert.equal(readHandoffInboxStatus(tmp), 'idle');
});

test('parseRolesTsv parses role, worktreePath, and displayName', () => {
  const tsv = [
    'coder\tmaster\t/proj\tswarmforge-coder\tCoder\tclaude\ttask',
    'cleaner\tcleaner\t/proj/.worktrees/cleaner\tswarmforge-cleaner\tCleaner\tclaude\tbatch',
    '',
  ].join('\n');

  const roles = parseRolesTsv(tsv);

  assert.equal(roles.length, 2);
  assert.deepEqual(roles[0], { role: 'coder', worktreePath: '/proj', displayName: 'Coder' });
  assert.deepEqual(roles[1], { role: 'cleaner', worktreePath: '/proj/.worktrees/cleaner', displayName: 'Cleaner' });
});

test('parseRolesTsv returns empty array for empty input', () => {
  assert.deepEqual(parseRolesTsv(''), []);
});

test('currentStageLabel returns active role displayName when one role is active', () => {
  const stages = [
    { role: 'coder', displayName: 'Coder', status: 'idle' },
    { role: 'cleaner', displayName: 'Cleaner', status: 'active' },
  ];
  assert.equal(currentStageLabel(stages), 'Cleaner');
});

test('currentStageLabel returns multiple names when several roles active', () => {
  const stages = [
    { role: 'coder', displayName: 'Coder', status: 'active' },
    { role: 'cleaner', displayName: 'Cleaner', status: 'active' },
  ];
  assert.equal(currentStageLabel(stages), 'Coder, Cleaner');
});

test('currentStageLabel returns idle label when no roles active', () => {
  const stages = [
    { role: 'coder', displayName: 'Coder', status: 'idle' },
  ];
  assert.equal(currentStageLabel(stages), 'idle');
});

test('readPipelineStages returns empty array when roles.tsv missing', () => {
  const tmp = mkTmp();
  assert.deepEqual(readPipelineStages(tmp), []);
});

test('readPipelineStages returns stages with idle status when inbox is empty', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  const tsv = `coder\tmaster\t${tmp}\tswarmforge-coder\tCoder\tclaude\ttask\n`;
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'roles.tsv'), tsv);

  const stages = readPipelineStages(tmp);
  assert.equal(stages.length, 1);
  assert.equal(stages[0].role, 'coder');
  assert.equal(stages[0].displayName, 'Coder');
  assert.equal(stages[0].status, 'idle');
});

test('readPipelineStages returns active status when handoff is in inbox/new', () => {
  const tmp = mkTmp();
  const swarmDir = path.join(tmp, '.swarmforge');
  mkdirp(swarmDir);
  const tsv = `coder\tmaster\t${tmp}\tswarmforge-coder\tCoder\tclaude\ttask\n`;
  fs.writeFileSync(path.join(swarmDir, 'roles.tsv'), tsv);

  const newDir = path.join(swarmDir, 'handoffs', 'inbox', 'new');
  mkdirp(newDir);
  fs.writeFileSync(path.join(newDir, '50_work.handoff'), 'from: helper\nto: coder\n');

  const stages = readPipelineStages(tmp);
  assert.equal(stages[0].status, 'active');
});
