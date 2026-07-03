const assert = require('node:assert/strict');
const test = require('node:test');
const { extractFunctionFromCode, loadPanelSource } = require('./helpers/extractPanelFunction');

// Exercises the real panel.js backlogRowHtml (not a hand-copied restatement
// of its logic — see extractPanelFunction.js for why that drifts silently).
// backlogRowHtml reads the module-level `holderMap` and (for active items,
// BL-034's assignee select) `tiles` as free variables; the Function
// constructor closes over the global scope, so we stub them there.
const backlogRowHtml = extractFunctionFromCode(loadPanelSource(), 'backlogRowHtml');
// backlogRowHtml calls the module-level stageColorClass (BL-077) as a free
// variable too; stub it on global alongside holderMap/tiles for the same
// reason (see comment above).
global.stageColorClass = extractFunctionFromCode(loadPanelSource(), 'stageColorClass');

test('backlogRowHtml includes id, title, and assigned for todo items', () => {
  global.holderMap = {};
  global.tiles = new Map();
  const item = { id: 'BL-001', title: 'Test item', status: 'todo', assignedTo: 'coder' };
  const html = backlogRowHtml(item);
  assert.match(html, /bl-id/);
  assert.match(html, /Test item/);
  assert.match(html, /bl-assigned/);
  assert.match(html, /coder/);
});

test('backlogRowHtml omits assigned span when assignedTo is missing', () => {
  global.holderMap = {};
  const item = { id: 'BL-002', title: 'Unassigned', status: 'todo' };
  const html = backlogRowHtml(item);
  assert.doesNotMatch(html, /bl-assigned/);
});

test('backlogRowHtml shows the live holder for active items, not the static assignedTo', () => {
  global.holderMap = { 'BL-001': 'coder' };
  global.tiles = new Map([['coder', {}], ['cleaner', {}]]);
  const item = { id: 'BL-001', title: 'Test item', status: 'active', assignedTo: 'architect' };
  const html = backlogRowHtml(item);
  assert.match(html, /bl-assigned/);
  assert.match(html, /coder/);
  assert.doesNotMatch(html, /architect/);
});

test('backlogRowHtml shows "queued" for active items with no live holder, never the static assignedTo (BL-072)', () => {
  global.holderMap = {};
  global.tiles = new Map([['coder', {}]]);
  const item = { id: 'BL-001', title: 'Test item', status: 'active', assignedTo: 'architect' };
  const html = backlogRowHtml(item);
  assert.match(html, /bl-assigned/);
  assert.match(html, /queued/);
  assert.doesNotMatch(html, /architect/);
});

test('backlogRowHtml renders the milestone badge for done items, not the assignedTo', () => {
  global.holderMap = {};
  const item = { id: 'BL-005', title: 'Completed item', status: 'done', assignedTo: 'coder', milestone: 'M1-mvp-observable-swarm' };
  const html = backlogRowHtml(item);
  assert.match(html, /bl-id/);
  assert.match(html, /Completed item/);
  assert.doesNotMatch(html, /bl-assigned/);
  assert.match(html, /bl-milestone/);
  assert.match(html, /M1-mvp-observable-swarm/);
});

test('backlogRowHtml omits the milestone badge for done items with no milestone', () => {
  global.holderMap = {};
  const item = { id: 'BL-006', title: 'Completed, unslugged', status: 'done' };
  const html = backlogRowHtml(item);
  assert.doesNotMatch(html, /bl-milestone/);
});
