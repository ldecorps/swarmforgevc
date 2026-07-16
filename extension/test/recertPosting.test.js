const assert = require('node:assert/strict');
const { renderRecertPosting } = require('../out/concierge/recertPosting');

// BL-450 recert-telegram-01: the Recert topic posts the current
// oldest-unreviewed scenario, one at a time.

function scenario(overrides = {}) {
  return { id: 'BL-207-thing-01', ticketId: 'BL-207', ticketTitle: 'a fine ticket', name: 'thing', text: 'Given a\nWhen b\nThen c', ...overrides };
}

test('renderRecertPosting includes the scenario id, ticket title, and scenario text', () => {
  const text = renderRecertPosting(scenario());
  assert.match(text, /BL-207-thing-01/);
  assert.match(text, /a fine ticket/);
  assert.match(text, /Given a/);
});

test('renderRecertPosting includes reply instructions naming validate/amend/delete with the scenario id', () => {
  const text = renderRecertPosting(scenario());
  assert.match(text, /validate BL-207-thing-01/);
  assert.match(text, /amend BL-207-thing-01/);
  assert.match(text, /delete BL-207-thing-01/);
});

test('renderRecertPosting renders different text for a different scenario', () => {
  const a = renderRecertPosting(scenario());
  const b = renderRecertPosting(scenario({ id: 'BL-300-other-01', ticketTitle: 'another ticket', text: 'Given x' }));
  assert.notEqual(a, b);
});
