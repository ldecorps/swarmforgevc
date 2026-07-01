const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { findLiveHolder } = require('../out/swarm/swarmState');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-holder-'));
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

function dropBatchHandoff(worktreePath, batchName, filename, content) {
  const dir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'in_process', batchName);
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, filename), content);
}

test('findLiveHolder returns null when roles.tsv is missing', () => {
  const target = mkTmp();
  assert.equal(findLiveHolder(target, 'BL-043'), null);
});

test('findLiveHolder returns the role holding a matching task in inbox/new', () => {
  const target = mkTmp();
  const coderWt = mkTmp();
  const cleanerWt = mkTmp();
  writeRolesTsv(target, [
    { role: 'coder', worktreePath: coderWt, displayName: 'Coder' },
    { role: 'cleaner', worktreePath: cleanerWt, displayName: 'Cleaner' },
  ]);
  dropHandoff(cleanerWt, 'new', '00_test.handoff', 'from: coder\nto: cleaner\ntask: bl-043-tile-layout\ncommit: abc\n');

  assert.equal(findLiveHolder(target, 'BL-043'), 'cleaner');
});

test('findLiveHolder returns the role holding a matching task in a batch subdirectory', () => {
  const target = mkTmp();
  const architectWt = mkTmp();
  writeRolesTsv(target, [{ role: 'architect', worktreePath: architectWt, displayName: 'Architect' }]);
  dropBatchHandoff(architectWt, 'batch_001', '00_test.handoff', 'from: cleaner\nto: architect\ntask: bl-044-footer-autoscroll\ncommit: abc\n');

  assert.equal(findLiveHolder(target, 'BL-044'), 'architect');
});

test('findLiveHolder matches case-insensitively', () => {
  const target = mkTmp();
  const architectWt = mkTmp();
  writeRolesTsv(target, [{ role: 'architect', worktreePath: architectWt, displayName: 'Architect' }]);
  dropHandoff(architectWt, 'new', '00_test.handoff', 'from: cleaner\nto: architect\ntask: BL-044-footer-autoscroll\ncommit: abc\n');

  assert.equal(findLiveHolder(target, 'bl-044'), 'architect');
});

test('findLiveHolder ignores idle stages even if their inbox later gets a matching handoff dropped in completed/', () => {
  const target = mkTmp();
  const coderWt = mkTmp();
  writeRolesTsv(target, [{ role: 'coder', worktreePath: coderWt, displayName: 'Coder' }]);
  // completed/ is not in INBOX_SUBDIRS, so this must not count as active or match
  dropHandoff(coderWt, 'completed', '00_test.handoff', 'from: cleaner\nto: coder\ntask: bl-043-tile-layout\ncommit: abc\n');

  assert.equal(findLiveHolder(target, 'BL-043'), null);
});

test('findLiveHolder returns null when no active stage holds a matching task', () => {
  const target = mkTmp();
  const coderWt = mkTmp();
  writeRolesTsv(target, [{ role: 'coder', worktreePath: coderWt, displayName: 'Coder' }]);
  dropHandoff(coderWt, 'new', '00_test.handoff', 'from: cleaner\nto: coder\ntask: bl-043-tile-layout\ncommit: abc\n');

  assert.equal(findLiveHolder(target, 'BL-099'), null);
});
