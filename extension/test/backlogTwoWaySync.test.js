const assert = require('node:assert/strict');
const { renderPanel } = require('./helpers/renderPanel');

// BL-034: panel -> disk field-level writes. The webview posts a message and
// the extension host does all I/O (backlogWriter.ts); these tests drive the
// REAL webview shell + REAL media/panel.js to prove the controls exist and
// post the right message, not a hand-copied restatement of the DOM.

function renderWithBacklog(items, roles) {
  const { document, dispatch, sentMessages } = renderPanel();
  dispatch({ type: 'roles', roles });
  dispatch({ type: 'backlogUpdate', items });
  return { document, dispatch, sentMessages };
}

test('an active row renders a mark-done control and an assignee select', () => {
  const items = [{ id: 'BL-200', title: 'active item', status: 'active', assignedTo: 'coder' }];
  const roles = [
    { role: 'coder', displayName: 'Coder', agent: 'claude' },
    { role: 'cleaner', displayName: 'Cleaner', agent: 'claude' },
  ];
  const { document } = renderWithBacklog(items, roles);

  const row = [...document.querySelectorAll('.backlog-row')].find((r) => r.querySelector('.bl-id').textContent === 'BL-200');
  assert.ok(row.querySelector('.bl-mark-done'), 'active row should render a mark-done control');
  const select = row.querySelector('.bl-assignee-select');
  assert.ok(select, 'active row should render an assignee select');
  assert.equal(select.value, 'coder');
});

test('clicking mark-done posts markBacklogDone with the item id', () => {
  const items = [{ id: 'BL-201', title: 'active item', status: 'active', assignedTo: 'coder' }];
  const roles = [{ role: 'coder', displayName: 'Coder', agent: 'claude' }];
  const { document, sentMessages } = renderWithBacklog(items, roles);

  const row = [...document.querySelectorAll('.backlog-row')].find((r) => r.querySelector('.bl-id').textContent === 'BL-201');
  row.querySelector('.bl-mark-done').click();

  const sent = sentMessages.find((m) => m.type === 'markBacklogDone');
  assert.ok(sent, 'expected a markBacklogDone message to be posted');
  assert.equal(sent.id, 'BL-201');
});

test('changing the assignee select posts setBacklogAssignee with the item id and new value', () => {
  const items = [{ id: 'BL-202', title: 'active item', status: 'active', assignedTo: 'coder' }];
  const roles = [
    { role: 'coder', displayName: 'Coder', agent: 'claude' },
    { role: 'cleaner', displayName: 'Cleaner', agent: 'claude' },
  ];
  const { document, sentMessages } = renderWithBacklog(items, roles);

  const row = [...document.querySelectorAll('.backlog-row')].find((r) => r.querySelector('.bl-id').textContent === 'BL-202');
  const select = row.querySelector('.bl-assignee-select');
  select.value = 'cleaner';
  select.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));

  const sent = sentMessages.find((m) => m.type === 'setBacklogAssignee');
  assert.ok(sent, 'expected a setBacklogAssignee message to be posted');
  assert.equal(sent.id, 'BL-202');
  assert.equal(sent.assignedTo, 'cleaner');
});

test('a done row renders neither a mark-done control nor an assignee select', () => {
  const items = [{ id: 'BL-203', title: 'done item', status: 'done', milestone: 'M4' }];
  const { document } = renderWithBacklog(items, []);

  const row = [...document.querySelectorAll('.backlog-row')].find((r) => r.querySelector('.bl-id').textContent === 'BL-203');
  assert.equal(row.querySelector('.bl-mark-done'), null);
  assert.equal(row.querySelector('.bl-assignee-select'), null);
});

test('a todo row renders neither a mark-done control nor an assignee select', () => {
  const items = [{ id: 'BL-204', title: 'todo item', status: 'todo', assignedTo: 'coder' }];
  const { document } = renderWithBacklog(items, []);

  const row = [...document.querySelectorAll('.backlog-row')].find((r) => r.querySelector('.bl-id').textContent === 'BL-204');
  assert.equal(row.querySelector('.bl-mark-done'), null);
  assert.equal(row.querySelector('.bl-assignee-select'), null);
});
