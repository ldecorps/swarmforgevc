const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yamlLib = require('js-yaml');
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

// BL-094: swarm assignment field (BL-090's own convention) - absent by
// default in live ticket YAML, callers apply the "primary" fallback.
test('parseBacklogYaml parses the swarm field when present', () => {
  const yaml = 'id: BL-007\ntitle: Backlog panel\nstatus: active\nswarm: secondary-1\n';
  const item = parseBacklogYaml(yaml);
  assert.equal(item.swarm, 'secondary-1');
});

test('parseBacklogYaml omits swarm when absent, never defaulting it itself', () => {
  const yaml = 'id: BL-007\ntitle: Backlog panel\nstatus: active\n';
  const item = parseBacklogYaml(yaml);
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'swarm'), false);
});

test('parseBacklogYaml handles title with colons in value', () => {
  const yaml = 'id: BL-007\ntitle: Named runs — branch and PR named after work item\nstatus: active\n';
  const item = parseBacklogYaml(yaml);
  assert.ok(item);
  assert.equal(item.title, 'Named runs — branch and PR named after work item');
});

test('parseBacklogYaml parses a pinned pack list (BL-064)', () => {
  const yaml = 'id: BL-064\ntitle: Lean pack\nstatus: active\npack:\n  - coder\n  - cleaner\n  - documenter\n';
  const item = parseBacklogYaml(yaml);
  assert.deepEqual(item.pack, ['coder', 'cleaner', 'documenter']);
});

test('parseBacklogYaml omits pack when the ticket has no pin (BL-064)', () => {
  const yaml = 'id: BL-064\ntitle: Unpinned\nstatus: active\n';
  const item = parseBacklogYaml(yaml);
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'pack'), false);
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

test('readBacklog marks active-folder items as active even when yaml status says todo', () => {
  const tmp = mkTmp();
  const activeDir = path.join(tmp, 'backlog', 'active');
  mkdirp(activeDir);
  fs.writeFileSync(
    path.join(activeDir, 'BL-053.yaml'),
    'id: BL-053\ntitle: Promoted item\nstatus: todo\nassigned_to: coder\n'
  );
  const items = readBacklog(tmp);
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'active');
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

// --- BL-062: done/ is grouped into per-milestone subfolders ---

test('readBacklog reads done items one level deep in milestone subfolders', () => {
  const tmp = mkTmp();
  const m2 = path.join(tmp, 'backlog', 'done', 'M2');
  mkdirp(m2);
  fs.writeFileSync(path.join(m2, 'BL-010.yaml'), 'id: BL-010\ntitle: Old item\nstatus: todo\n');
  const items = readBacklog(tmp);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'BL-010');
  assert.equal(items[0].status, 'done');
});

test('readBacklog surfaces the subfolder slug as the done item milestone', () => {
  const tmp = mkTmp();
  // subfolder names are opaque slugs, not bare M-numbers; the folder is
  // canonical even when the yaml disagrees
  const m4 = path.join(tmp, 'backlog', 'done', 'M4-governance-backlog-sync');
  mkdirp(m4);
  fs.writeFileSync(path.join(m4, 'BL-011.yaml'), 'id: BL-011\ntitle: Moved item\nstatus: done\nmilestone: M1\n');
  const items = readBacklog(tmp);
  assert.equal(items[0].milestone, 'M4-governance-backlog-sync');
});

test('flat done files keep their yaml milestone field', () => {
  const tmp = mkTmp();
  const doneDir = path.join(tmp, 'backlog', 'done');
  mkdirp(doneDir);
  fs.writeFileSync(path.join(doneDir, 'BL-015.yaml'), 'id: BL-015\ntitle: Flat\nstatus: done\nmilestone: M2\n');
  const items = readBacklog(tmp);
  assert.equal(items[0].milestone, 'M2');
});

test('readBacklog still reads flat done files during the transition', () => {
  const tmp = mkTmp();
  const doneDir = path.join(tmp, 'backlog', 'done');
  mkdirp(path.join(doneDir, 'M1'));
  fs.writeFileSync(path.join(doneDir, 'BL-012.yaml'), 'id: BL-012\ntitle: Flat done\nstatus: done\n');
  fs.writeFileSync(path.join(doneDir, 'M1', 'BL-013.yaml'), 'id: BL-013\ntitle: Grouped done\nstatus: done\n');
  const items = readBacklog(tmp);
  assert.deepEqual(items.map((i) => i.id).sort(), ['BL-012', 'BL-013']);
  assert.ok(items.every((i) => i.status === 'done'));
});

test('readBacklog ignores non-yaml entries and two-level-deep yamls under done/', () => {
  const tmp = mkTmp();
  const m3 = path.join(tmp, 'backlog', 'done', 'M3');
  mkdirp(path.join(m3, 'nested'));
  fs.writeFileSync(path.join(m3, 'README.md'), '# notes');
  fs.writeFileSync(path.join(m3, 'nested', 'BL-014.yaml'), 'id: BL-014\ntitle: Too deep\nstatus: done\n');
  const items = readBacklog(tmp);
  assert.equal(items.length, 0);
});

test('dependency gating counts a subfoldered done ticket as satisfied', () => {
  const { nextEligibleItem } = require('../out/swarm/backlogLoop');
  const tmp = mkTmp();
  const m3 = path.join(tmp, 'backlog', 'done', 'M3');
  const activeDir = path.join(tmp, 'backlog', 'active');
  mkdirp(m3);
  mkdirp(activeDir);
  fs.writeFileSync(path.join(m3, 'BL-020.yaml'), 'id: BL-020\ntitle: Done dep\nstatus: done\n');
  fs.writeFileSync(
    path.join(activeDir, 'BL-021.yaml'),
    'id: BL-021\ntitle: Blocked until dep done\nstatus: active\ndepends_on:\n  - BL-020\n'
  );
  const next = nextEligibleItem(readBacklog(tmp));
  assert.ok(next, 'the dependent item must be eligible once its dep is done in a subfolder');
  assert.equal(next.id, 'BL-021');
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

// --- BL-129: strict js-yaml load() first, lenient regex fallback on failure ---

test('BL-129 strict-path-01: a well-formed ticket parses identically via the strict path', () => {
  const yaml = 'id: BL-007\ntitle: Backlog panel\nstatus: active\nassigned_to: coder\nmilestone: M1\npriority: 5\npack:\n  - coder\n  - cleaner\n';
  const item = parseBacklogYaml(yaml);
  assert.deepEqual(item, {
    id: 'BL-007',
    title: 'Backlog panel',
    status: 'active',
    assignedTo: 'coder',
    milestone: 'M1',
    priority: 5,
    pack: ['coder', 'cleaner'],
  });
});

test('BL-129 strict-path-01: strict parsing does not surface stray keys outside the BacklogItem contract', () => {
  const yaml = 'id: BL-007\ntitle: Backlog panel\nstatus: active\nevidence: some measured evidence\nnotes: internal only\n';
  const item = parseBacklogYaml(yaml);
  assert.deepEqual(item, { id: 'BL-007', title: 'Backlog panel', status: 'active' });
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'evidence'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'notes'), false);
});

// The following BL-129 fallback fixtures are trimmed prefixes of real backlog
// tickets (measured 2026-07-06 to throw under strict js-yaml load() with the
// message noted) — not synthetic strings, so the reproduction matches what
// adopting js-yaml actually does to the live backlog.

test('BL-129 fallback-02: an unquoted colon-space in a free-form title throws strict js-yaml but the ticket still surfaces (BL-093 shape)', () => {
  const content = 'id: BL-093\ntitle: BUG — pane input injection is unreliable: instructions sit typed-but-unsubmitted, no seam verifies delivery, and a wedged TUI is unrecoverable by send-keys\nstatus: done\n';
  assert.throws(() => yamlLib.load(content), /bad indentation/);
  const item = parseBacklogYaml(content);
  assert.ok(item, 'the ticket must not be dropped');
  assert.equal(item.id, 'BL-093');
  assert.equal(item.status, 'done');
});

test('BL-129 fallback-02: bad indentation of a mapping entry throws strict js-yaml but the ticket still surfaces (BL-097 shape)', () => {
  const content = 'id: BL-097\ntitle: backlog dashboard PWA — serverless read-only projection of backlog/ via Action-rendered backlog.json on Pages\nmilestone: M6\nstatus: todo\npriority: 02\nsource: operator spec request 2026-07-04 ("Backlog dashboard app: read-only projection of backlog/ from git")\n';
  assert.throws(() => yamlLib.load(content), /bad indentation/);
  const item = parseBacklogYaml(content);
  assert.ok(item, 'the ticket must not be dropped');
  assert.equal(item.id, 'BL-097');
  assert.equal(item.milestone, 'M6');
});

test('BL-129 fallback-02: a multiline implicit key throws strict js-yaml but the ticket still surfaces (BL-128 shape)', () => {
  const content = 'id: BL-128\ntitle: give coordinator and specifier their own physical mailbox instead of sharing the master-worktree inbox\nmilestone: M3\nstatus: todo\npriority: 01\n\nheld (coordinator, 2026-07-05): not promoted yet despite priority 01 — Concurrent\nWork Orthogonality. BL-121/122 (handoff transport detection/recovery, top\npriority) are mid-pipeline right now (hardener stage) and touch the same\n';
  assert.throws(() => yamlLib.load(content), /multiline key/);
  const item = parseBacklogYaml(content);
  assert.ok(item, 'the ticket must not be dropped');
  assert.equal(item.id, 'BL-128');
  assert.equal(item.priority, 1);
});

test('BL-129 no-regression-03: every real gnarly ticket the lenient parser already reads still parses after adopting js-yaml', () => {
  const gnarlyFixtures = [
    'id: BL-093\ntitle: BUG — pane input injection is unreliable: instructions sit typed-but-unsubmitted, no seam verifies delivery, and a wedged TUI is unrecoverable by send-keys\nstatus: done\n',
    'id: BL-097\ntitle: backlog dashboard PWA — serverless read-only projection of backlog/ via Action-rendered backlog.json on Pages\nmilestone: M6\nstatus: todo\npriority: 02\nsource: operator spec request 2026-07-04 ("Backlog dashboard app: read-only projection of backlog/ from git")\n',
    'id: BL-128\ntitle: give coordinator and specifier their own physical mailbox instead of sharing the master-worktree inbox\nmilestone: M3\nstatus: todo\npriority: 01\n\nheld (coordinator, 2026-07-05): not promoted yet despite priority 01 — Concurrent\nWork Orthogonality. BL-121/122 (handoff transport detection/recovery, top\npriority) are mid-pipeline right now (hardener stage) and touch the same\n',
  ];
  for (const fixture of gnarlyFixtures) {
    const item = parseBacklogYaml(fixture);
    assert.ok(item, `expected a ticket to surface for fixture: ${fixture}`);
  }
});

test('BL-129: a strict-parseable object missing a required field yields null (no lenient retry within the strict branch)', () => {
  const item = parseBacklogYaml('id: BL-999\ntitle: missing status\n');
  assert.equal(item, null);
});

test('BL-129: a strict-parseable object with an invalid status enum value yields null', () => {
  const item = parseBacklogYaml('id: BL-999\ntitle: bad status\nstatus: cancelled\n');
  assert.equal(item, null);
});

test('BL-129: a quoted numeric priority string is coerced to a number via the strict path', () => {
  const item = parseBacklogYaml('id: BL-007\ntitle: quoted priority\nstatus: todo\npriority: "5"\n');
  assert.equal(item.priority, 5);
});

test('BL-129: an empty assigned_to/milestone string is omitted, not kept as ""', () => {
  const item = parseBacklogYaml('id: BL-007\ntitle: empty optional fields\nstatus: todo\nassigned_to: ""\nmilestone: ""\n');
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'assignedTo'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'milestone'), false);
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

test('readBacklog overrides done folder items to status done regardless of YAML', () => {
  const tmp = mkTmp();
  const doneDir = path.join(tmp, 'backlog', 'done');
  mkdirp(doneDir);
  fs.writeFileSync(path.join(doneDir, 'BL-001.yaml'), 'id: BL-001\ntitle: Done item\nstatus: active\n');
  const items = readBacklog(tmp);
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'done');
});

// --- BL-034: disk -> panel direction. readBacklog re-parses fresh from disk
// on every call with no caching, so any external edit or move is visible on
// the very next call - the same call the host's 2s poll makes every tick.
// These pin that contract directly against this ticket's scenarios. ---

test('BL-034: an external title edit on disk is reflected on the next read', () => {
  const tmp = mkTmp();
  const activeDir = path.join(tmp, 'backlog', 'active');
  mkdirp(activeDir);
  const filePath = path.join(activeDir, 'BL-200.yaml');
  fs.writeFileSync(filePath, 'id: BL-200\ntitle: old title\nstatus: active\n');
  assert.equal(readBacklog(tmp).find((i) => i.id === 'BL-200').title, 'old title');

  fs.writeFileSync(filePath, 'id: BL-200\ntitle: new title\nstatus: active\n');

  assert.equal(readBacklog(tmp).find((i) => i.id === 'BL-200').title, 'new title');
});

test('BL-034: an external move from active/ to done/<milestone>/ is reflected on the next read', () => {
  const tmp = mkTmp();
  const activeDir = path.join(tmp, 'backlog', 'active');
  mkdirp(activeDir);
  const filePath = path.join(activeDir, 'BL-201.yaml');
  fs.writeFileSync(filePath, 'id: BL-201\ntitle: moving item\nstatus: active\nmilestone: M4\n');
  assert.equal(readBacklog(tmp).find((i) => i.id === 'BL-201').status, 'active');

  const doneDir = path.join(tmp, 'backlog', 'done', 'M4');
  mkdirp(doneDir);
  fs.renameSync(filePath, path.join(doneDir, 'BL-201.yaml'));

  assert.equal(readBacklog(tmp).find((i) => i.id === 'BL-201').status, 'done');
});
