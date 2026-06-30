const assert = require('node:assert/strict');
const test = require('node:test');

const { buildBadgeMap, truncateSummary } = require('../out/panel/badgeSummary');

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
