const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setAssignedTo, markDone } = require('../out/panel/backlogWriter');
const { readBacklog } = require('../out/panel/backlogReader');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-backlog-writer-'));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeActiveItem(targetPath, filename, yaml) {
  const dir = path.join(targetPath, 'backlog', 'active');
  mkdirp(dir);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, yaml);
  return filePath;
}

// --- setAssignedTo (BL-034 backlog-two-way-sync-04) ---

test('setAssignedTo updates only the assigned_to field, leaving every other field byte-identical', () => {
  const target = mkTmp();
  const yaml = 'id: BL-100\ntitle: some item\nstatus: active\npriority: 10\nassigned_to: coder\n\ndescription: |\n  multi\n  line\n  block\n';
  const filePath = writeActiveItem(target, 'BL-100-some-item.yaml', yaml);

  const ok = setAssignedTo(target, 'BL-100', 'cleaner');

  assert.equal(ok, true);
  const updated = fs.readFileSync(filePath, 'utf8');
  assert.equal(updated, yaml.replace('assigned_to: coder', 'assigned_to: cleaner'));
});

test('setAssignedTo returns false when the item id does not exist in backlog/active', () => {
  const target = mkTmp();
  mkdirp(path.join(target, 'backlog', 'active'));

  assert.equal(setAssignedTo(target, 'BL-404', 'cleaner'), false);
});

// --- markDone (BL-034 backlog-two-way-sync-03) ---

test('markDone moves the file to backlog/done/<milestone>/ when the item has a milestone', () => {
  const target = mkTmp();
  writeActiveItem(target, 'BL-101-milestone-item.yaml', 'id: BL-101\ntitle: t\nstatus: active\nmilestone: M4\n');

  const result = markDone(target, 'BL-101');

  assert.equal(result.moved, true);
  assert.equal(result.destination, path.join(target, 'backlog', 'done', 'M4', 'BL-101-milestone-item.yaml'));
  assert.equal(fs.existsSync(path.join(target, 'backlog', 'active', 'BL-101-milestone-item.yaml')), false);
  assert.equal(fs.existsSync(result.destination), true);
});

test('markDone moves the file to flat backlog/done/ when the item has no milestone', () => {
  const target = mkTmp();
  writeActiveItem(target, 'BL-102-no-milestone.yaml', 'id: BL-102\ntitle: t\nstatus: active\n');

  const result = markDone(target, 'BL-102');

  assert.equal(result.destination, path.join(target, 'backlog', 'done', 'BL-102-no-milestone.yaml'));
});

test('markDone does not rewrite the YAML status field - the folder is authoritative', () => {
  const target = mkTmp();
  writeActiveItem(target, 'BL-103-status-check.yaml', 'id: BL-103\ntitle: t\nstatus: active\nmilestone: M4\n');

  const result = markDone(target, 'BL-103');

  const content = fs.readFileSync(result.destination, 'utf8');
  assert.match(content, /^status: active$/m);
});

test('markDone result is visible as done when the backlog is re-read (folder authoritative)', () => {
  const target = mkTmp();
  writeActiveItem(target, 'BL-104-visible.yaml', 'id: BL-104\ntitle: t\nstatus: active\nmilestone: M4\n');

  markDone(target, 'BL-104');

  const items = readBacklog(target);
  const item = items.find((i) => i.id === 'BL-104');
  assert.equal(item.status, 'done');
});

test('markDone returns moved false when the item id does not exist in backlog/active', () => {
  const target = mkTmp();
  mkdirp(path.join(target, 'backlog', 'active'));

  const result = markDone(target, 'BL-404');

  assert.equal(result.moved, false);
});
