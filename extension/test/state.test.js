const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readHandoffInboxStatus, parseRolesTsv, currentStageLabel, readPipelineStages, mailboxDir, mailboxBaseDir } = require('../out/swarm/swarmState');

function mkTmp() {
  return mkTmpDir('sfvc-test-');
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// BL-128: readHandoffInboxStatus now takes a role-entry-shaped object (role +
// worktreeName + worktreePath) rather than a bare worktreePath, since the
// mailbox it reads depends on worktreeName too (master-resident roles get
// their own <role> subdirectory). These fixtures use a dedicated-worktree
// role (worktreeName distinct from "master") so the inbox stays at the flat,
// pre-BL-128 layout the fixtures below build on disk.
function roleAt(worktreePath) {
  return { role: 'coder', worktreeName: 'coder', worktreePath };
}

test('readHandoffInboxStatus returns idle when no inbox exists', () => {
  const tmp = mkTmp();
  assert.equal(readHandoffInboxStatus(roleAt(tmp)), 'idle');
});

test('readHandoffInboxStatus returns active when handoff in inbox/new', () => {
  const tmp = mkTmp();
  const newDir = path.join(tmp, '.swarmforge', 'handoffs', 'inbox', 'new');
  mkdirp(newDir);
  fs.writeFileSync(path.join(newDir, '50_test.handoff'), 'from: coder\nto: cleaner\n');
  assert.equal(readHandoffInboxStatus(roleAt(tmp)), 'active');
});

test('readHandoffInboxStatus returns active when handoff in inbox/in_process batch subdir', () => {
  const tmp = mkTmp();
  const batchDir = path.join(tmp, '.swarmforge', 'handoffs', 'inbox', 'in_process', 'batch_001');
  mkdirp(batchDir);
  fs.writeFileSync(path.join(batchDir, '50_test.handoff'), 'from: coder\nto: cleaner\n');
  assert.equal(readHandoffInboxStatus(roleAt(tmp)), 'active');
});

test('readHandoffInboxStatus returns idle when inbox dirs exist but are empty', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge', 'handoffs', 'inbox', 'new'));
  mkdirp(path.join(tmp, '.swarmforge', 'handoffs', 'inbox', 'in_process'));
  assert.equal(readHandoffInboxStatus(roleAt(tmp)), 'idle');
});

test('readHandoffInboxStatus reads the <role> subdirectory for a master-resident role', () => {
  const tmp = mkTmp();
  const newDir = path.join(tmp, '.swarmforge', 'handoffs', 'coordinator', 'inbox', 'new');
  mkdirp(newDir);
  fs.writeFileSync(path.join(newDir, '50_test.handoff'), 'from: specifier\nto: coordinator\n');
  assert.equal(readHandoffInboxStatus({ role: 'coordinator', worktreeName: 'master', worktreePath: tmp }), 'active');
});

// BL-128 mailbox-isolation: master-resident roles (coordinator, specifier)
// get their own <role> subdirectory; roles with a dedicated worktree keep
// the pre-BL-128 flat layout.
test('mailboxBaseDir adds a <role> subdirectory only for worktreeName "master"', () => {
  assert.equal(
    mailboxBaseDir({ role: 'coordinator', worktreeName: 'master', worktreePath: '/proj' }),
    path.join('/proj', '.swarmforge', 'handoffs', 'coordinator'),
  );
  assert.equal(
    mailboxBaseDir({ role: 'coder', worktreeName: 'coder', worktreePath: '/proj/.worktrees/coder' }),
    path.join('/proj/.worktrees/coder', '.swarmforge', 'handoffs'),
  );
});

test('mailboxDir gives coordinator and specifier physically distinct mailboxes on the shared master worktree', () => {
  const coordinator = { role: 'coordinator', worktreeName: 'master', worktreePath: '/proj' };
  const specifier = { role: 'specifier', worktreeName: 'master', worktreePath: '/proj' };
  const coordinatorNew = mailboxDir(coordinator, 'inbox', 'new');
  const specifierNew = mailboxDir(specifier, 'inbox', 'new');
  assert.notEqual(coordinatorNew, specifierNew);
  assert.equal(coordinatorNew, path.join('/proj', '.swarmforge', 'handoffs', 'coordinator', 'inbox', 'new'));
  assert.equal(specifierNew, path.join('/proj', '.swarmforge', 'handoffs', 'specifier', 'inbox', 'new'));
});

test('parseRolesTsv parses role, worktreeName, worktreePath, displayName, and agent', () => {
  const tsv = [
    'coder\tcoder\t/proj/.worktrees/coder\tswarmforge-coder\tCoder\tclaude\ttask',
    'cleaner\tcleaner\t/proj/.worktrees/cleaner\tswarmforge-cleaner\tCleaner\taider\tbatch',
    '',
  ].join('\n');

  const roles = parseRolesTsv(tsv);

  assert.equal(roles.length, 2);
  assert.deepEqual(roles[0], {
    role: 'coder',
    worktreeName: 'coder',
    worktreePath: '/proj/.worktrees/coder',
    displayName: 'Coder',
    agent: 'claude',
  });
  assert.deepEqual(roles[1], {
    role: 'cleaner',
    worktreeName: 'cleaner',
    worktreePath: '/proj/.worktrees/cleaner',
    displayName: 'Cleaner',
    agent: 'aider',
  });
});

// BL-208: a TSV row missing the agent column (an older/shorter format)
// must not throw - agent reads as undefined, never crashes a caller that
// groups by provider.
test('parseRolesTsv tolerates a missing agent column', () => {
  const tsv = 'coder\tcoder\t/proj/.worktrees/coder\tswarmforge-coder\tCoder\n';
  const roles = parseRolesTsv(tsv);
  assert.equal(roles.length, 1);
  assert.equal(roles[0].agent, undefined);
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
  const tsv = `coder\tcoder\t${tmp}\tswarmforge-coder\tCoder\tclaude\ttask\n`;
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
  const tsv = `coder\tcoder\t${tmp}\tswarmforge-coder\tCoder\tclaude\ttask\n`;
  fs.writeFileSync(path.join(swarmDir, 'roles.tsv'), tsv);

  const newDir = path.join(swarmDir, 'handoffs', 'inbox', 'new');
  mkdirp(newDir);
  fs.writeFileSync(path.join(newDir, '50_work.handoff'), 'from: helper\nto: coder\n');

  const stages = readPipelineStages(tmp);
  assert.equal(stages[0].status, 'active');
});

test('readPipelineStages reports no held ticket ids when in_process is empty', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  const tsv = `coder\tcoder\t${tmp}\tswarmforge-coder\tCoder\tclaude\ttask\n`;
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'roles.tsv'), tsv);

  const stages = readPipelineStages(tmp);
  assert.deepEqual(stages[0].heldTicketIds, []);
});

// BL-452: the pipeline board's own data source - each role's CURRENTLY held
// ticket id(s), read straight off the in_process handoff's task field. A
// task name that carries a suffix past the bare ticket id (the normal
// "short-stable-task-name" shape, e.g. a slug) still resolves to just the
// ticket id.
test('readPipelineStages extracts the ticket id from the in_process handoff task field', () => {
  const tmp = mkTmp();
  const swarmDir = path.join(tmp, '.swarmforge');
  mkdirp(swarmDir);
  const tsv = `coder\tcoder\t${tmp}\tswarmforge-coder\tCoder\tclaude\ttask\n`;
  fs.writeFileSync(path.join(swarmDir, 'roles.tsv'), tsv);

  const inProcessDir = path.join(swarmDir, 'handoffs', 'inbox', 'in_process');
  mkdirp(inProcessDir);
  fs.writeFileSync(
    path.join(inProcessDir, '00_work.handoff'),
    'from: specifier\nto: coder\ntype: git_handoff\ntask: BL-452-pipeline-board-telegram-topic\n'
  );

  const stages = readPipelineStages(tmp);
  assert.deepEqual(stages[0].heldTicketIds, ['BL-452']);
});

// A handoff sitting in inbox/new (queued, not yet picked up) is not a
// CURRENT hold - only in_process counts, distinguishing this reader from
// readHandoffInboxStatus's own new+in_process status check above.
test('readPipelineStages does not count a queued inbox/new handoff as a held ticket', () => {
  const tmp = mkTmp();
  const swarmDir = path.join(tmp, '.swarmforge');
  mkdirp(swarmDir);
  const tsv = `coder\tcoder\t${tmp}\tswarmforge-coder\tCoder\tclaude\ttask\n`;
  fs.writeFileSync(path.join(swarmDir, 'roles.tsv'), tsv);

  const newDir = path.join(swarmDir, 'handoffs', 'inbox', 'new');
  mkdirp(newDir);
  fs.writeFileSync(path.join(newDir, '50_work.handoff'), 'from: helper\nto: coder\ntask: BL-900\n');

  const stages = readPipelineStages(tmp);
  assert.deepEqual(stages[0].heldTicketIds, []);
});

// A batch role (cleaner/hardener) may hold several parcels at once, filed
// under in_process/batch_<...>/ subdirectories - every one of them counts.
test('readPipelineStages collects every ticket id a batch role holds in_process', () => {
  const tmp = mkTmp();
  const swarmDir = path.join(tmp, '.swarmforge');
  mkdirp(swarmDir);
  const tsv = `cleaner\tcleaner\t${tmp}\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n`;
  fs.writeFileSync(path.join(swarmDir, 'roles.tsv'), tsv);

  const batchDir = path.join(swarmDir, 'handoffs', 'inbox', 'in_process', 'batch_20260716');
  mkdirp(batchDir);
  fs.writeFileSync(path.join(batchDir, '00_a.handoff'), 'from: coder\nto: cleaner\ntask: BL-100\n');
  fs.writeFileSync(path.join(batchDir, '01_b.handoff'), 'from: coder\nto: cleaner\ntask: BL-101-a-slug\n');

  const stages = readPipelineStages(tmp);
  assert.deepEqual([...stages[0].heldTicketIds].sort(), ['BL-100', 'BL-101']);
});

// A handoff with no task field at all (absent) names no ticket - distinct
// from the malformed case below, which is PRESENT but does not parse.
test('readPipelineStages omits an in_process handoff with no task field', () => {
  const tmp = mkTmp();
  const swarmDir = path.join(tmp, '.swarmforge');
  mkdirp(swarmDir);
  const tsv = `coder\tcoder\t${tmp}\tswarmforge-coder\tCoder\tclaude\ttask\n`;
  fs.writeFileSync(path.join(swarmDir, 'roles.tsv'), tsv);

  const inProcessDir = path.join(swarmDir, 'handoffs', 'inbox', 'in_process');
  mkdirp(inProcessDir);
  fs.writeFileSync(path.join(inProcessDir, '00_work.handoff'), 'from: specifier\nto: coder\ntype: note\nmessage: hello\n');

  const stages = readPipelineStages(tmp);
  assert.deepEqual(stages[0].heldTicketIds, []);
});

// A task field that is PRESENT but does not start with a "Word-Number"
// ticket id (extractTicketId returns null) names no ticket either - the
// present-but-unparseable case must not be silently conflated with a real
// id the way an absent field is, but it must still be dropped, not thrown.
test('readPipelineStages omits an in_process handoff whose task field does not parse to a ticket id', () => {
  const tmp = mkTmp();
  const swarmDir = path.join(tmp, '.swarmforge');
  mkdirp(swarmDir);
  const tsv = `coder\tcoder\t${tmp}\tswarmforge-coder\tCoder\tclaude\ttask\n`;
  fs.writeFileSync(path.join(swarmDir, 'roles.tsv'), tsv);

  const inProcessDir = path.join(swarmDir, 'handoffs', 'inbox', 'in_process');
  mkdirp(inProcessDir);
  fs.writeFileSync(path.join(inProcessDir, '00_work.handoff'), 'from: specifier\nto: coder\ntype: git_handoff\ntask: no-ticket-prefix-here\n');

  const stages = readPipelineStages(tmp);
  assert.deepEqual(stages[0].heldTicketIds, []);
});

test('readPipelineStages resolves each master-resident role to its own <role> subdirectory, not a shared one', () => {
  const tmp = mkTmp();
  const swarmDir = path.join(tmp, '.swarmforge');
  mkdirp(swarmDir);
  const tsv = [
    `coordinator\tmaster\t${tmp}\tswarmforge-coordinator\tCoordinator\tclaude\ttask`,
    `specifier\tmaster\t${tmp}\tswarmforge-specifier\tSpecifier\tclaude\ttask`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(swarmDir, 'roles.tsv'), tsv);

  const coordinatorNewDir = path.join(swarmDir, 'handoffs', 'coordinator', 'inbox', 'new');
  mkdirp(coordinatorNewDir);
  fs.writeFileSync(path.join(coordinatorNewDir, '50_work.handoff'), 'from: specifier\nto: coordinator\n');
  // specifier's own mailbox stays empty.
  mkdirp(path.join(swarmDir, 'handoffs', 'specifier', 'inbox', 'new'));

  const stages = readPipelineStages(tmp);
  const byRole = Object.fromEntries(stages.map((s) => [s.role, s.status]));
  assert.equal(byRole.coordinator, 'active');
  assert.equal(byRole.specifier, 'idle');
});
