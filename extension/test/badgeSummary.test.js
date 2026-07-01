const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildBadgeMap, truncateSummary } = require('../out/panel/badgeSummary');

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
