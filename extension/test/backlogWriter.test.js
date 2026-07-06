const assert = require('node:assert/strict');
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

test('setAssignedTo does not match a file whose parsed id differs from the requested id', () => {
  const target = mkTmp();
  writeActiveItem(target, 'BL-105-other.yaml', 'id: BL-105\ntitle: other\nstatus: active\nassigned_to: coder\n');

  assert.equal(setAssignedTo(target, 'BL-404', 'cleaner'), false);
  const untouched = fs.readFileSync(path.join(target, 'backlog', 'active', 'BL-105-other.yaml'), 'utf8');
  assert.match(untouched, /assigned_to: coder/);
});

test('setAssignedTo returns false without throwing when backlog/active does not exist', () => {
  const target = mkTmp();

  assert.equal(setAssignedTo(target, 'BL-404', 'cleaner'), false);
});

test('setAssignedTo returns false and leaves the file untouched when it has no assigned_to line', () => {
  const target = mkTmp();
  const yaml = 'id: BL-106\ntitle: no assignee\nstatus: active\n';
  const filePath = writeActiveItem(target, 'BL-106-no-assignee.yaml', yaml);

  const ok = setAssignedTo(target, 'BL-106', 'cleaner');

  assert.equal(ok, false);
  assert.equal(fs.readFileSync(filePath, 'utf8'), yaml);
});

test('setAssignedTo replaces only the line that begins with assigned_to, not an occurrence embedded in another key', () => {
  const target = mkTmp();
  const yaml = 'id: BL-107\ntitle: t\nstatus: active\nprevious_assigned_to: ghost\nassigned_to: coder\n';
  const filePath = writeActiveItem(target, 'BL-107-anchor.yaml', yaml);

  const ok = setAssignedTo(target, 'BL-107', 'cleaner');

  assert.equal(ok, true);
  const updated = fs.readFileSync(filePath, 'utf8');
  assert.match(updated, /^previous_assigned_to: ghost$/m);
  assert.match(updated, /^assigned_to: cleaner$/m);
});

test('setAssignedTo updates the field even when there is no space after the colon', () => {
  const target = mkTmp();
  const filePath = writeActiveItem(target, 'BL-108-nospace.yaml', 'id: BL-108\ntitle: t\nstatus: active\nassigned_to:coder\n');

  const ok = setAssignedTo(target, 'BL-108', 'cleaner');

  assert.equal(ok, true);
  assert.match(fs.readFileSync(filePath, 'utf8'), /^assigned_to: cleaner$/m);
});

test('setAssignedTo ignores non-.yaml files in backlog/active even when one parses and matches first alphabetically', () => {
  const target = mkTmp();
  const activeDir = path.join(target, 'backlog', 'active');
  mkdirp(activeDir);
  const decoyPath = path.join(activeDir, '0-decoy.txt');
  fs.writeFileSync(decoyPath, 'id: BL-109\ntitle: decoy\nstatus: active\nassigned_to: ghost\n');
  const filePath = writeActiveItem(target, 'BL-109-real.yaml', 'id: BL-109\ntitle: real\nstatus: active\nassigned_to: coder\n');

  const ok = setAssignedTo(target, 'BL-109', 'cleaner');

  assert.equal(ok, true);
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'id: BL-109\ntitle: real\nstatus: active\nassigned_to: cleaner\n');
  assert.equal(fs.readFileSync(decoyPath, 'utf8'), 'id: BL-109\ntitle: decoy\nstatus: active\nassigned_to: ghost\n');
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
