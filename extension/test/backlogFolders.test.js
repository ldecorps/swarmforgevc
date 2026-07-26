const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readBacklogFolders, lookupBacklogItemById } = require('../out/panel/backlogReader');

function mkTmp() {
  return mkTmpDir('sfvc-backlog-folders-');
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

  assert.deepEqual(folders.active, [{ id: 'BL-001', title: 'active one', status: 'todo', filename: 'BL-001.yaml' }]);
  assert.deepEqual(folders.paused, [{ id: 'BL-002', title: 'paused one', status: 'todo', filename: 'BL-002.yaml' }]);
  assert.deepEqual(folders.done, [{ id: 'BL-003', title: 'done one', status: 'done', filename: 'BL-003.yaml' }]);
});

test('readBacklogFolders groups done items under milestone subfolders', () => {
  const target = mkTmp();
  writeYaml(path.join(target, 'backlog', 'done', 'M1'), 'BL-004.yaml', 'id: BL-004\ntitle: milestone done\nstatus: done\n');

  const folders = readBacklogFolders(target);

  assert.deepEqual(folders.done, [{ id: 'BL-004', title: 'milestone done', status: 'done', milestone: 'M1', filename: 'BL-004.yaml' }]);
});

test('readBacklogFolders returns empty arrays for folders that do not exist', () => {
  const target = mkTmp();

  const folders = readBacklogFolders(target);

  assert.deepEqual(folders, { active: [], paused: [], done: [], hold: [] });
});

// ── BL-234: the folder is authoritative for the bucket - status is never a
// drop gate, and never picks the bucket either. ────────────────────────────

test('BL-234 no-status-field-01: a ticket with no status field is still bucketed by its folder', () => {
  const target = mkTmp();
  writeYaml(path.join(target, 'backlog', 'active'), 'BL-100.yaml', 'id: BL-100\ntitle: no status active\n');
  writeYaml(path.join(target, 'backlog', 'paused'), 'BL-101.yaml', 'id: BL-101\ntitle: no status paused\n');
  writeYaml(path.join(target, 'backlog', 'done'), 'BL-102.yaml', 'id: BL-102\ntitle: no status done\n');

  const folders = readBacklogFolders(target);

  assert.deepEqual(folders.active.map((i) => i.id), ['BL-100']);
  assert.deepEqual(folders.paused.map((i) => i.id), ['BL-101']);
  assert.deepEqual(folders.done.map((i) => i.id), ['BL-102']);
});

test('BL-234 unrecognized-status-02: a ticket whose status is unrecognized is still bucketed by its folder', () => {
  const target = mkTmp();
  writeYaml(path.join(target, 'backlog', 'paused'), 'BL-103.yaml', 'id: BL-103\ntitle: blocked in paused\nstatus: blocked\n');
  writeYaml(path.join(target, 'backlog', 'paused'), 'BL-104.yaml', 'id: BL-104\ntitle: paused in paused\nstatus: paused\n');
  writeYaml(path.join(target, 'backlog', 'active'), 'BL-105.yaml', 'id: BL-105\ntitle: blocked in active\nstatus: blocked\n');

  const folders = readBacklogFolders(target);

  assert.deepEqual(
    folders.paused.map((i) => i.id).sort(),
    ['BL-103', 'BL-104']
  );
  assert.deepEqual(folders.active.map((i) => i.id), ['BL-105']);
});

test('BL-234 folder-over-stale-status-03: the folder is authoritative over a stale but valid status field', () => {
  const target = mkTmp();
  writeYaml(path.join(target, 'backlog', 'paused'), 'BL-106.yaml', 'id: BL-106\ntitle: stale active\nstatus: active\n');

  const folders = readBacklogFolders(target);

  assert.deepEqual(folders.paused.map((i) => i.id), ['BL-106']);
  assert.deepEqual(folders.active, []);
});

test('BL-234 unparseable-skipped-04: a file missing a required field is skipped, not bucketed', () => {
  const target = mkTmp();
  writeYaml(path.join(target, 'backlog', 'paused'), 'no-id.yaml', 'title: no id here\nstatus: todo\n');
  writeYaml(path.join(target, 'backlog', 'paused'), 'no-title.yaml', 'id: BL-107\nstatus: todo\n');

  const folders = readBacklogFolders(target);

  assert.deepEqual(folders.paused, []);
});

test('BL-234 none-dropped-05: no parseable ticket is silently dropped from its folder', () => {
  const target = mkTmp();
  writeYaml(path.join(target, 'backlog', 'paused'), 'BL-108.yaml', 'id: BL-108\ntitle: absent status\n');
  writeYaml(path.join(target, 'backlog', 'paused'), 'BL-109.yaml', 'id: BL-109\ntitle: unrecognized status\nstatus: blocked\n');
  writeYaml(path.join(target, 'backlog', 'paused'), 'BL-110.yaml', 'id: BL-110\ntitle: valid status\nstatus: todo\n');

  const folders = readBacklogFolders(target);

  assert.deepEqual(
    folders.paused.map((i) => i.id).sort(),
    ['BL-108', 'BL-109', 'BL-110']
  );
});

// ── BL-672: lookupBacklogItemById is a direct consumer of readBacklogFolders'
// hold field - a shared reader gaining a bucket is worthless if its own
// consumers keep spreading the old set. ────────────────────────────────────

test('lookupBacklogItemById finds a ticket that lives only in backlog/hold', () => {
  const target = mkTmp();
  writeYaml(path.join(target, 'backlog', 'hold'), 'BL-200.yaml', 'id: BL-200\ntitle: human-held one\nstatus: todo\n');

  const found = lookupBacklogItemById(target, 'BL-200');

  assert.equal(found && found.title, 'human-held one');
});

test('lookupBacklogItemById is case-insensitive and picks the right item among several candidates', () => {
  const target = mkTmp();
  writeYaml(path.join(target, 'backlog', 'active'), 'BL-201.yaml', 'id: BL-201\ntitle: active one\nstatus: todo\n');
  writeYaml(path.join(target, 'backlog', 'paused'), 'BL-202.yaml', 'id: BL-202\ntitle: paused one\nstatus: todo\n');
  writeYaml(path.join(target, 'backlog', 'hold'), 'BL-203.yaml', 'id: BL-203\ntitle: held one\nstatus: todo\n');
  writeYaml(path.join(target, 'backlog', 'done'), 'BL-204.yaml', 'id: BL-204\ntitle: done one\nstatus: done\n');

  assert.equal(lookupBacklogItemById(target, 'bl-203').title, 'held one');
  assert.equal(lookupBacklogItemById(target, 'BL-201').title, 'active one');
  assert.equal(lookupBacklogItemById(target, 'BL-204').title, 'done one');
  assert.equal(lookupBacklogItemById(target, 'BL-999'), undefined);
});
