const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseBacklogYaml, readBacklog } = require('../out/panel/backlogReader');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-backlog-test-'));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// --- parseBacklogYaml ---

test('parseBacklogYaml returns item with all required fields', () => {
  const yaml = 'id: BL-007\ntitle: Backlog panel\nstatus: active\nassigned_to: coder\n';
  const item = parseBacklogYaml(yaml);
  assert.deepEqual(item, { id: 'BL-007', title: 'Backlog panel', status: 'active', assignedTo: 'coder' });
});

test('parseBacklogYaml returns item without assignedTo when assigned_to absent', () => {
  const yaml = 'id: BL-009\ntitle: Future item\nstatus: todo\n';
  const item = parseBacklogYaml(yaml);
  assert.deepEqual(item, { id: 'BL-009', title: 'Future item', status: 'todo' });
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'assignedTo'), false);
});

test('parseBacklogYaml returns null when id is missing', () => {
  const yaml = 'title: Backlog panel\nstatus: active\n';
  assert.equal(parseBacklogYaml(yaml), null);
});

test('parseBacklogYaml returns null when title is missing', () => {
  const yaml = 'id: BL-007\nstatus: active\n';
  assert.equal(parseBacklogYaml(yaml), null);
});

test('parseBacklogYaml returns null when status is missing', () => {
  const yaml = 'id: BL-007\ntitle: Backlog panel\n';
  assert.equal(parseBacklogYaml(yaml), null);
});

test('parseBacklogYaml returns null for invalid status value', () => {
  const yaml = 'id: BL-007\ntitle: Backlog panel\nstatus: in-progress\n';
  assert.equal(parseBacklogYaml(yaml), null);
});

test('parseBacklogYaml parses known optional fields (milestone, priority)', () => {
  const yaml = 'id: BL-007\ntitle: Backlog panel\nstatus: done\nmilestone: M1\npriority: 5\n';
  const item = parseBacklogYaml(yaml);
  assert.deepEqual(item, { id: 'BL-007', title: 'Backlog panel', status: 'done', milestone: 'M1', priority: 5 });
});

test('parseBacklogYaml handles title with colons in value', () => {
  const yaml = 'id: BL-007\ntitle: Named runs — branch and PR named after work item\nstatus: active\n';
  const item = parseBacklogYaml(yaml);
  assert.ok(item);
  assert.equal(item.title, 'Named runs — branch and PR named after work item');
});

test('parseBacklogYaml handles done status', () => {
  const yaml = 'id: BL-001\ntitle: Done item\nstatus: done\n';
  const item = parseBacklogYaml(yaml);
  assert.ok(item);
  assert.equal(item.status, 'done');
});

// --- readBacklog ---

test('readBacklog returns empty array when target has no backlog dir', () => {
  const tmp = mkTmp();
  assert.deepEqual(readBacklog(tmp), []);
});

test('readBacklog returns empty array when backlog dirs exist but are empty', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, 'backlog', 'active'));
  mkdirp(path.join(tmp, 'backlog', 'done'));
  assert.deepEqual(readBacklog(tmp), []);
});

test('readBacklog reads items from active directory', () => {
  const tmp = mkTmp();
  const activeDir = path.join(tmp, 'backlog', 'active');
  mkdirp(activeDir);
  fs.writeFileSync(path.join(activeDir, 'BL-007.yaml'), 'id: BL-007\ntitle: Backlog panel\nstatus: active\nassigned_to: coder\n');
  const items = readBacklog(tmp);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'BL-007');
});

test('readBacklog reads items from done directory', () => {
  const tmp = mkTmp();
  const doneDir = path.join(tmp, 'backlog', 'done');
  mkdirp(doneDir);
  fs.writeFileSync(path.join(doneDir, 'BL-001.yaml'), 'id: BL-001\ntitle: Done thing\nstatus: done\n');
  const items = readBacklog(tmp);
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'done');
});

test('readBacklog reads items from both active and done directories', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, 'backlog', 'active'));
  mkdirp(path.join(tmp, 'backlog', 'done'));
  fs.writeFileSync(path.join(tmp, 'backlog', 'active', 'BL-007.yaml'), 'id: BL-007\ntitle: Active item\nstatus: active\n');
  fs.writeFileSync(path.join(tmp, 'backlog', 'done', 'BL-001.yaml'), 'id: BL-001\ntitle: Done item\nstatus: done\n');
  const items = readBacklog(tmp);
  assert.equal(items.length, 2);
});

test('readBacklog skips non-yaml files', () => {
  const tmp = mkTmp();
  const activeDir = path.join(tmp, 'backlog', 'active');
  mkdirp(activeDir);
  fs.writeFileSync(path.join(activeDir, 'README.md'), '# notes');
  fs.writeFileSync(path.join(activeDir, 'BL-007.yaml'), 'id: BL-007\ntitle: Backlog panel\nstatus: active\n');
  const items = readBacklog(tmp);
  assert.equal(items.length, 1);
});

test('readBacklog skips malformed yaml files', () => {
  const tmp = mkTmp();
  const activeDir = path.join(tmp, 'backlog', 'active');
  mkdirp(activeDir);
  fs.writeFileSync(path.join(activeDir, 'bad.yaml'), 'not: valid: backlog: entry\n');
  fs.writeFileSync(path.join(activeDir, 'good.yaml'), 'id: BL-007\ntitle: Good\nstatus: active\n');
  const items = readBacklog(tmp);
  assert.equal(items.length, 1);
});

test('readBacklog handles read errors gracefully', () => {
  const tmp = mkTmp();
  const activeDir = path.join(tmp, 'backlog', 'active');
  mkdirp(activeDir);
  const yamlFile = path.join(activeDir, 'BL-007.yaml');
  fs.writeFileSync(yamlFile, 'id: BL-007\ntitle: Backlog panel\nstatus: active\n');
  fs.chmodSync(yamlFile, 0o000);
  const items = readBacklog(tmp);
  assert.equal(items.length, 0);
  fs.chmodSync(yamlFile, 0o644);
});
