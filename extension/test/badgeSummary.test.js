const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildBadgeMap, truncateSummary } = require('../out/panel/badgeSummary');
const { readBacklog } = require('../out/panel/backlogReader');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-badge-'));
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

function dropHandoff(worktreePath, filename, content) {
  const dir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'new');
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, filename), content);
}

// --- truncateSummary ---

test('truncateSummary returns full title if under 40 chars', () => {
  const title = 'backlog panel';
  const result = truncateSummary(title);
  assert.equal(result, 'backlog panel');
});

test('truncateSummary truncates at 40 chars with ellipsis', () => {
  const title = 'this is a really long tile header that exceeds forty characters';
  const result = truncateSummary(title);
  assert.equal(result.length, 40);
  assert.ok(result.endsWith('…'));
});

test('truncateSummary strips leading "backlog panel " prefix', () => {
  const title = 'backlog panel — hide assignee badge on done rows';
  const result = truncateSummary(title);
  assert.ok(!result.startsWith('backlog panel'));
  assert.equal(result, 'hide assignee badge on done rows');
});

test('truncateSummary handles multiple section prefixes', () => {
  const title = 'tile header — show active ticket ID';
  const result = truncateSummary(title);
  assert.equal(result, 'show active ticket ID');
});

test('truncateSummary truncates after stripping prefix if still too long', () => {
  const title = 'tile header — this is a really long summary that still exceeds the forty character limit';
  const result = truncateSummary(title);
  assert.equal(result.length, 40);
  assert.ok(result.endsWith('…'));
});

test('truncateSummary handles empty title', () => {
  const result = truncateSummary('');
  assert.equal(result, '');
});

test('truncateSummary handles title with only prefix', () => {
  const title = 'backlog panel — ';
  const result = truncateSummary(title);
  assert.equal(result, '');
});

// --- buildBadgeMap ---

test('buildBadgeMap returns object with id and summary for active items', () => {
  const items = [
    { id: 'BL-038', title: 'tile header — show active ticket ID', status: 'active', assignedTo: 'coder' },
  ];
  const result = buildBadgeMap(items);
  assert.ok(result.coder);
  assert.equal(result.coder.id, 'BL-038');
  assert.ok(result.coder.summary);
  assert.equal(result.coder.summary, 'show active ticket ID');
});

test('buildBadgeMap includes complete formatted badge text', () => {
  const items = [
    { id: 'BL-033', title: 'backlog panel — derive item status from folder', status: 'active', assignedTo: 'cleaner' },
  ];
  const result = buildBadgeMap(items);
  assert.equal(result.cleaner.id, 'BL-033');
  assert.equal(result.cleaner.summary, 'derive item status from folder');
});

test('buildBadgeMap skips non-active items', () => {
  const items = [
    { id: 'BL-001', title: 'done item', status: 'done', assignedTo: 'coder' },
    { id: 'BL-002', title: 'todo item', status: 'todo', assignedTo: 'coder' },
  ];
  const result = buildBadgeMap(items);
  assert.equal(Object.keys(result).length, 0);
});

test('buildBadgeMap skips active items without assignedTo', () => {
  const items = [
    { id: 'BL-038', title: 'tile header', status: 'active' },
  ];
  const result = buildBadgeMap(items);
  assert.equal(Object.keys(result).length, 0);
});

test('buildBadgeMap handles multiple active items for different roles', () => {
  const items = [
    { id: 'BL-001', title: 'item one', status: 'active', assignedTo: 'coder' },
    { id: 'BL-002', title: 'item two', status: 'active', assignedTo: 'cleaner' },
  ];
  const result = buildBadgeMap(items);
  assert.equal(Object.keys(result).length, 2);
  assert.ok(result.coder);
  assert.ok(result.cleaner);
});

test('buildBadgeMap truncates long summaries to 40 chars', () => {
  const items = [
    {
      id: 'BL-001',
      title: 'this is an extremely long title that definitely exceeds the forty character limit',
      status: 'active',
      assignedTo: 'coder'
    },
  ];
  const result = buildBadgeMap(items);
  assert.ok(result.coder.summary.length <= 40);
});

// --- buildBadgeMap live holder (BL-047) ---

test('buildBadgeMap keys the badge on the live holder when the parcel has moved', () => {
  const target = mkTmp();
  const cleanerWt = mkTmp();
  writeRolesTsv(target, [{ role: 'cleaner', worktreePath: cleanerWt, displayName: 'Cleaner' }]);
  dropHandoff(cleanerWt, '00_test.handoff', 'from: coder\nto: cleaner\ntask: bl-043-tile-layout\ncommit: abc\n');

  const items = [{ id: 'BL-043', title: 'tile layout', status: 'active', assignedTo: 'coder' }];
  const result = buildBadgeMap(items, target);

  assert.ok(result.cleaner, 'badge should be keyed on the live holder (cleaner), not the static assignee (coder)');
  assert.equal(result.coder, undefined, 'no badge should remain on the original static assignee');
  assert.equal(result.cleaner.holder, 'cleaner');
});

test('buildBadgeMap falls back to the static assignee when no live holder is found', () => {
  const target = mkTmp();
  writeRolesTsv(target, []);

  const items = [{ id: 'BL-043', title: 'tile layout', status: 'active', assignedTo: 'coder' }];
  const result = buildBadgeMap(items, target);

  assert.ok(result.coder, 'badge should fall back to the static assignee when no live holder is found');
  assert.equal(result.coder.holder, 'coder');
});

test('buildBadgeMap ignores targetPath for non-active items', () => {
  const target = mkTmp();
  const items = [{ id: 'BL-001', title: 'todo item', status: 'todo', assignedTo: 'coder' }];
  const result = buildBadgeMap(items, target);
  assert.equal(Object.keys(result).length, 0);
});

// --- BL-053: the active FOLDER is authoritative, yaml status may lag ---

test('folder-active item whose yaml still says todo produces a badge (BL-053)', () => {
  const target = mkTmp();
  writeRolesTsv(target, []);
  const activeDir = path.join(target, 'backlog', 'active');
  mkdirp(activeDir);
  fs.writeFileSync(
    path.join(activeDir, 'BL-053.yaml'),
    'id: BL-053\ntitle: redo BL-038 tile header active ticket\nstatus: todo\nassigned_to: coder\n'
  );

  const items = readBacklog(target);
  const result = buildBadgeMap(items, target);

  assert.ok(result.coder, 'badge must render for a promoted item even when its yaml status was left as todo');
  assert.equal(result.coder.id, 'BL-053');
  assert.equal(result.coder.summary, 'redo BL-038 tile header active ticket');
});

// --- BL-068: a role holding multiple parcels shows the lowest ID + count ---
// (regression: the previous last-write-wins loop silently dropped every
// badge but the last one processed when several active items resolved to
// the same holder — verified live against this repo's own backlog, which
// currently has 5 active items all assigned to "coder" and produced exactly
// one surviving badge instead of one-badge-plus-a-count.)

test('a role holding multiple parcels shows the lowest ticket ID plus a +N count', () => {
  const items = [
    { id: 'BL-061', title: 'handoffd deadlock', status: 'active', assignedTo: 'hardender' },
    { id: 'BL-036', title: 'redo_from tool', status: 'active', assignedTo: 'hardender' },
  ];
  const result = buildBadgeMap(items);
  assert.ok(result.hardender, 'the holder must still get a badge, not be silently dropped');
  assert.equal(result.hardender.id, 'BL-036', 'the lowest ticket ID must be the primary badge');
  assert.equal(result.hardender.extraCount, 1, 'the remaining parcel must be counted, not dropped');
});

test('a role holding three parcels counts the two not shown', () => {
  const items = [
    { id: 'BL-062', title: 'done milestone reader', status: 'active', assignedTo: 'hardender' },
    { id: 'BL-059', title: 'needs-human blink red', status: 'active', assignedTo: 'hardender' },
    { id: 'BL-060', title: 'suite speed fix', status: 'active', assignedTo: 'hardender' },
  ];
  const result = buildBadgeMap(items);
  assert.equal(result.hardender.id, 'BL-059');
  assert.equal(result.hardender.extraCount, 2);
});

test('a role holding a single parcel has no extraCount', () => {
  const items = [
    { id: 'BL-038', title: 'tile header', status: 'active', assignedTo: 'coder' },
  ];
  const result = buildBadgeMap(items);
  assert.equal(result.coder.extraCount, undefined);
});

test('multiple parcels resolve the lowest ID numerically, not lexicographically', () => {
  const items = [
    { id: 'BL-100', title: 'later item', status: 'active', assignedTo: 'coder' },
    { id: 'BL-9', title: 'earlier item', status: 'active', assignedTo: 'coder' },
  ];
  const result = buildBadgeMap(items);
  assert.equal(result.coder.id, 'BL-9', 'BL-9 sorts before BL-100 numerically even though "1" < "9" lexicographically');
});

test('multiple roles each holding multiple parcels get independent primary badges and counts', () => {
  const items = [
    { id: 'BL-061', title: 'handoffd deadlock', status: 'active', assignedTo: 'hardender' },
    { id: 'BL-036', title: 'redo_from tool', status: 'active', assignedTo: 'hardender' },
    { id: 'BL-045', title: 'needs-human detection', status: 'active', assignedTo: 'coder' },
    { id: 'BL-050', title: 'tile-grid fix', status: 'active', assignedTo: 'coder' },
    { id: 'BL-058', title: 'dev-host bounce', status: 'active', assignedTo: 'coder' },
  ];
  const result = buildBadgeMap(items);

  assert.equal(result.hardender.id, 'BL-036', "hardender's own lowest ID must not be affected by coder's items");
  assert.equal(result.hardender.extraCount, 1);
  assert.equal(result.coder.id, 'BL-045', "coder's own lowest ID must not be affected by hardender's items");
  assert.equal(result.coder.extraCount, 2, 'coder holds 3 parcels total, so 2 must be counted as extra');
});

test('a live-holder tie between two items for the same role also gets counted, not overwritten', () => {
  const target = mkTmp();
  const hardenerWt = mkTmp();
  writeRolesTsv(target, [{ role: 'hardender', worktreePath: hardenerWt, displayName: 'Hardender' }]);
  dropHandoff(hardenerWt, '00_a.handoff', 'from: architect\nto: hardender\ntask: bl-061-handoffd-deadlock\ncommit: abc\n');
  dropHandoff(hardenerWt, '00_b.handoff', 'from: architect\nto: hardender\ntask: bl-036-redo-from\ncommit: abc\n');

  const items = [
    { id: 'BL-061', title: 'handoffd deadlock', status: 'active', assignedTo: 'hardender' },
    { id: 'BL-036', title: 'redo_from tool', status: 'active', assignedTo: 'hardender' },
  ];
  const result = buildBadgeMap(items, target);

  assert.ok(result.hardender, 'both live-held parcels must resolve to one counted badge, not silently overwrite each other');
  assert.equal(result.hardender.id, 'BL-036');
  assert.equal(result.hardender.extraCount, 1);
});

test('folder-active item with lagging yaml status is badged on the live holder (BL-053)', () => {
  const target = mkTmp();
  const cleanerWt = mkTmp();
  writeRolesTsv(target, [{ role: 'cleaner', worktreePath: cleanerWt, displayName: 'Cleaner' }]);
  dropHandoff(cleanerWt, '00_test.handoff', 'from: coder\nto: cleaner\ntask: BL-053-redo-tile-header\ncommit: abc\n');
  const activeDir = path.join(target, 'backlog', 'active');
  mkdirp(activeDir);
  fs.writeFileSync(
    path.join(activeDir, 'BL-053.yaml'),
    'id: BL-053\ntitle: redo BL-038 tile header active ticket\nstatus: todo\nassigned_to: coder\n'
  );

  const result = buildBadgeMap(readBacklog(target), target);

  assert.ok(result.cleaner, 'badge must follow the live holder for a folder-active item');
  assert.equal(result.coder, undefined, 'no badge should remain on the static assignee');
});
