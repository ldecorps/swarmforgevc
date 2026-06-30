/**
 * BL-017/018/019: Work Tree panel, item completion loop, traceability tags.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

const { parseBacklogYaml, readBacklog } = require('../out/panel/backlogReader');
const { nextEligibleItem } = require('../out/swarm/backlogLoop');
const { lastCommitForItem } = require('../out/panel/gitTracer');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-wt-test-'));
}
function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// ── BL-017: backlogReader extended fields ──────────────────────────────────

test('parseBacklogYaml parses milestone field', () => {
  const yaml = 'id: BL-017\ntitle: Work tree\nstatus: active\nmilestone: M3\n';
  const item = parseBacklogYaml(yaml);
  assert.ok(item);
  assert.equal(item.milestone, 'M3');
});

test('parseBacklogYaml parses priority as number', () => {
  const yaml = 'id: BL-017\ntitle: Work tree\nstatus: active\npriority: 17\n';
  const item = parseBacklogYaml(yaml);
  assert.ok(item);
  assert.equal(item.priority, 17);
});

test('parseBacklogYaml omits milestone when absent', () => {
  const yaml = 'id: BL-017\ntitle: Work tree\nstatus: active\n';
  const item = parseBacklogYaml(yaml);
  assert.ok(item);
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'milestone'), false);
});

test('parseBacklogYaml omits priority when absent', () => {
  const yaml = 'id: BL-017\ntitle: Work tree\nstatus: active\n';
  const item = parseBacklogYaml(yaml);
  assert.ok(item);
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'priority'), false);
});

test('parseBacklogYaml parses depends_on list', () => {
  const yaml = 'id: BL-018\ntitle: Loop\nstatus: active\ndepends_on:\n  - BL-017\n  - BL-A\n';
  const item = parseBacklogYaml(yaml);
  assert.ok(item);
  assert.deepEqual(item.dependsOn, ['BL-017', 'BL-A']);
});

test('parseBacklogYaml omits dependsOn when absent', () => {
  const yaml = 'id: BL-017\ntitle: Work tree\nstatus: active\n';
  const item = parseBacklogYaml(yaml);
  assert.ok(item);
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'dependsOn'), false);
});

test('parseBacklogYaml parses depends_on with comment suffixes stripped', () => {
  const yaml = 'id: BL-017\ntitle: Work tree\nstatus: active\ndepends_on:\n  - BL-A  # target selection\n  - BL-B  # infra\n';
  const item = parseBacklogYaml(yaml);
  assert.ok(item);
  assert.deepEqual(item.dependsOn, ['BL-A', 'BL-B']);
});

test('readBacklog items sorted active-by-priority-asc then done', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, 'backlog', 'active'));
  mkdirp(path.join(tmp, 'backlog', 'done'));
  fs.writeFileSync(path.join(tmp, 'backlog', 'active', 'BL-019.yaml'),
    'id: BL-019\ntitle: Tags\nstatus: active\npriority: 19\n');
  fs.writeFileSync(path.join(tmp, 'backlog', 'active', 'BL-017.yaml'),
    'id: BL-017\ntitle: Work tree\nstatus: active\npriority: 17\n');
  fs.writeFileSync(path.join(tmp, 'backlog', 'done', 'BL-001.yaml'),
    'id: BL-001\ntitle: Done\nstatus: done\npriority: 1\n');
  const items = readBacklog(tmp);
  assert.equal(items[0].id, 'BL-017');
  assert.equal(items[1].id, 'BL-019');
  assert.equal(items[2].id, 'BL-001');
});

test('readBacklog active items without priority sort after active-with-priority', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, 'backlog', 'active'));
  fs.writeFileSync(path.join(tmp, 'backlog', 'active', 'BL-005.yaml'),
    'id: BL-005\ntitle: No priority\nstatus: active\n');
  fs.writeFileSync(path.join(tmp, 'backlog', 'active', 'BL-017.yaml'),
    'id: BL-017\ntitle: Has priority\nstatus: active\npriority: 17\n');
  const items = readBacklog(tmp);
  assert.equal(items[0].id, 'BL-017');
  assert.equal(items[1].id, 'BL-005');
});

// ── BL-018: nextEligibleItem ───────────────────────────────────────────────

test('nextEligibleItem returns null for empty list', () => {
  assert.equal(nextEligibleItem([]), null);
});

test('nextEligibleItem returns null when all items are done', () => {
  const items = [{ id: 'BL-001', title: 'Done', status: 'done' }];
  assert.equal(nextEligibleItem(items), null);
});

test('nextEligibleItem returns lowest-priority active item with no dependencies', () => {
  const items = [
    { id: 'BL-017', title: 'Work tree', status: 'active', priority: 17 },
    { id: 'BL-019', title: 'Tags', status: 'active', priority: 19 },
  ];
  const result = nextEligibleItem(items);
  assert.ok(result);
  assert.equal(result.id, 'BL-017');
});

test('nextEligibleItem skips items whose depends_on are still active', () => {
  const items = [
    { id: 'BL-017', title: 'Work tree', status: 'active', priority: 17 },
    { id: 'BL-018', title: 'Loop', status: 'active', priority: 18, dependsOn: ['BL-017'] },
  ];
  const result = nextEligibleItem(items);
  assert.ok(result);
  assert.equal(result.id, 'BL-017');
});

test('nextEligibleItem elects item when its dependency is done', () => {
  const items = [
    { id: 'BL-017', title: 'Work tree', status: 'done', priority: 17 },
    { id: 'BL-018', title: 'Loop', status: 'active', priority: 18, dependsOn: ['BL-017'] },
  ];
  const result = nextEligibleItem(items);
  assert.ok(result);
  assert.equal(result.id, 'BL-018');
});

test('nextEligibleItem skips item with multiple deps if any dep still active', () => {
  const items = [
    { id: 'BL-001', title: 'A', status: 'done' },
    { id: 'BL-002', title: 'B', status: 'active', priority: 2 },
    { id: 'BL-003', title: 'C', status: 'active', priority: 3, dependsOn: ['BL-001', 'BL-002'] },
  ];
  const result = nextEligibleItem(items);
  assert.ok(result);
  assert.equal(result.id, 'BL-002');
});

test('nextEligibleItem returns null when all active items are blocked', () => {
  const items = [
    { id: 'BL-017', title: 'Work tree', status: 'active', priority: 17 },
    { id: 'BL-018', title: 'Loop', status: 'active', priority: 18, dependsOn: ['BL-017'] },
    { id: 'BL-019', title: 'Tags', status: 'active', priority: 19, dependsOn: ['BL-017', 'BL-018'] },
  ];
  // BL-017 has no deps → eligible; but let's test when ALL are blocked
  // Make BL-017 depend on something not in the list (unknown dep stays "not done")
  const blockedItems = [
    { id: 'BL-018', title: 'Loop', status: 'active', priority: 18, dependsOn: ['BL-017'] },
    { id: 'BL-019', title: 'Tags', status: 'active', priority: 19, dependsOn: ['BL-017'] },
  ];
  // BL-017 is not in the list at all, so deps are unsatisfied
  assert.equal(nextEligibleItem(blockedItems), null);
});

// ── BL-019: gitTracer ─────────────────────────────────────────────────────

function initGitRepo(dir) {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test');
  execSync('git add README.md', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' });
}

test('lastCommitForItem returns null when no matching commit', () => {
  const tmp = mkTmp();
  initGitRepo(tmp);
  const result = lastCommitForItem(tmp, 'BL-999');
  assert.equal(result, null);
});

test('lastCommitForItem returns hash and message for matching commit', () => {
  const tmp = mkTmp();
  initGitRepo(tmp);
  fs.writeFileSync(path.join(tmp, 'change.txt'), 'x');
  execSync('git add change.txt', { cwd: tmp, stdio: 'pipe' });
  execSync('git commit -m "BL-017: add work tree panel"', { cwd: tmp, stdio: 'pipe' });
  const result = lastCommitForItem(tmp, 'BL-017');
  assert.ok(result);
  assert.ok(result.hash.match(/^[0-9a-f]{7,}/));
  assert.ok(result.message.includes('BL-017'));
});

test('lastCommitForItem returns most recent matching commit', () => {
  const tmp = mkTmp();
  initGitRepo(tmp);
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'a');
  execSync('git add a.txt', { cwd: tmp, stdio: 'pipe' });
  execSync('git commit -m "BL-017: first"', { cwd: tmp, stdio: 'pipe' });
  fs.writeFileSync(path.join(tmp, 'b.txt'), 'b');
  execSync('git add b.txt', { cwd: tmp, stdio: 'pipe' });
  execSync('git commit -m "BL-017: second"', { cwd: tmp, stdio: 'pipe' });
  const result = lastCommitForItem(tmp, 'BL-017');
  assert.ok(result);
  assert.ok(result.message.includes('second'));
});

test('lastCommitForItem returns null when targetPath is not a git repo', () => {
  const tmp = mkTmp();
  const result = lastCommitForItem(tmp, 'BL-017');
  assert.equal(result, null);
});
