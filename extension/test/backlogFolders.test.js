const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readBacklogFolders } = require('../out/panel/backlogReader');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-backlog-folders-'));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeYaml(dir, filename, yaml) {
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, filename), yaml);
}

test('readBacklogFolders projects active, paused, and done items unchanged from their yaml status', () => {
  const target = mkTmp();
  writeYaml(path.join(target, 'backlog', 'active'), 'BL-001.yaml', 'id: BL-001\ntitle: active one\nstatus: todo\n');
  writeYaml(path.join(target, 'backlog', 'paused'), 'BL-002.yaml', 'id: BL-002\ntitle: paused one\nstatus: todo\n');
  writeYaml(path.join(target, 'backlog', 'done'), 'BL-003.yaml', 'id: BL-003\ntitle: done one\nstatus: done\n');

  const folders = readBacklogFolders(target);

  assert.deepEqual(folders.active, [{ id: 'BL-001', title: 'active one', status: 'todo' }]);
  assert.deepEqual(folders.paused, [{ id: 'BL-002', title: 'paused one', status: 'todo' }]);
  assert.deepEqual(folders.done, [{ id: 'BL-003', title: 'done one', status: 'done' }]);
});

test('readBacklogFolders groups done items under milestone subfolders', () => {
  const target = mkTmp();
  writeYaml(path.join(target, 'backlog', 'done', 'M1'), 'BL-004.yaml', 'id: BL-004\ntitle: milestone done\nstatus: done\n');

  const folders = readBacklogFolders(target);

  assert.deepEqual(folders.done, [{ id: 'BL-004', title: 'milestone done', status: 'done', milestone: 'M1' }]);
});

test('readBacklogFolders returns empty arrays for folders that do not exist', () => {
  const target = mkTmp();

  const folders = readBacklogFolders(target);

  assert.deepEqual(folders, { active: [], paused: [], done: [] });
});
