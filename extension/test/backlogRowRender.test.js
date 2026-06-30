const assert = require('node:assert/strict');
const test = require('node:test');

function backlogRowHtml(item) {
  const assigned = item.assignedTo && item.status !== 'done' ? '<span class="bl-assigned">' + item.assignedTo + '</span>' : '';
  return '<div class="backlog-row">' +
    '<span class="bl-id">' + item.id + '</span>' +
    '<span class="bl-title">' + item.title + '</span>' +
    assigned + '</div>';
}

test('backlogRowHtml includes id, title, and assigned for active items', () => {
  const item = { id: 'BL-001', title: 'Test item', status: 'active', assignedTo: 'coder' };
  const html = backlogRowHtml(item);
  assert.match(html, /bl-id/);
  assert.match(html, /Test item/);
  assert.match(html, /bl-assigned/);
  assert.match(html, /coder/);
});

test('backlogRowHtml includes id and title but omits assigned for done items', () => {
  const item = { id: 'BL-005', title: 'Completed item', status: 'done', assignedTo: 'coder' };
  const html = backlogRowHtml(item);
  assert.match(html, /bl-id/);
  assert.match(html, /Completed item/);
  assert.doesNotMatch(html, /bl-assigned/);
});

test('backlogRowHtml includes assigned for todo items', () => {
  const item = { id: 'BL-003', title: 'Future item', status: 'todo', assignedTo: 'coder' };
  const html = backlogRowHtml(item);
  assert.match(html, /bl-assigned/);
  assert.match(html, /coder/);
});

test('backlogRowHtml omits assigned span when assignedTo is missing', () => {
  const item = { id: 'BL-002', title: 'Unassigned', status: 'active' };
  const html = backlogRowHtml(item);
  assert.doesNotMatch(html, /bl-assigned/);
});
