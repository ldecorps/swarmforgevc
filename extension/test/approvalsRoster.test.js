const assert = require('node:assert/strict');
const { renderApprovalsRoster } = require('../out/concierge/approvalsRoster');

// BL-434 approvals-standing-topic-04: the Approvals topic maintains a live
// roster of every currently-pending ticket.

test('renderApprovalsRoster: no pending tickets renders a plain "nothing pending" message', () => {
  assert.equal(renderApprovalsRoster([]), 'No tickets are currently awaiting approval.');
});

test('renderApprovalsRoster: one pending ticket lists its id and title', () => {
  const text = renderApprovalsRoster([{ id: 'BL-433', title: 'a fine feature' }]);
  assert.match(text, /BL-433 - a fine feature/);
});

test('renderApprovalsRoster: multiple pending tickets are ALL listed', () => {
  const text = renderApprovalsRoster([
    { id: 'BL-440', title: 'second' },
    { id: 'BL-433', title: 'first' },
  ]);
  assert.match(text, /BL-433/);
  assert.match(text, /BL-440/);
});

test('renderApprovalsRoster: pending tickets are sorted by id - deterministic regardless of input order', () => {
  const a = renderApprovalsRoster([
    { id: 'BL-440', title: 'second' },
    { id: 'BL-433', title: 'first' },
  ]);
  const b = renderApprovalsRoster([
    { id: 'BL-433', title: 'first' },
    { id: 'BL-440', title: 'second' },
  ]);
  assert.equal(a, b);
});

test('renderApprovalsRoster: a ticket with no title still renders, keyed by id alone', () => {
  const text = renderApprovalsRoster([{ id: 'BL-433' }]);
  assert.match(text, /BL-433/);
});
