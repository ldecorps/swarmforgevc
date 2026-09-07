const assert = require('node:assert/strict');
const { isBacklogTicketId, BACKLOG_TICKET_ID_PATTERN } = require('../out/tools/backlogTicketId');

// BL-1452: the ONE shared ticket-id predicate every TypeScript tool that
// validates a ticket id argument must import - bounceArgsCore.ts's and
// qa-sibling-check.ts's own former private `^BL-\d+$` copies rejected a
// GitHub-seeded ticket (GH-<n>, BL-114) outright.

test('accepts a BL-seeded ticket id', () => {
  assert.equal(isBacklogTicketId('BL-590'), true);
});

test('accepts a GH-seeded ticket id', () => {
  assert.equal(isBacklogTicketId('GH-24'), true);
});

test('is case-insensitive', () => {
  assert.equal(isBacklogTicketId('bl-590'), true);
  assert.equal(isBacklogTicketId('gh-24'), true);
});

test('rejects an id in neither known namespace', () => {
  assert.equal(isBacklogTicketId('XY-24'), false);
});

test('rejects a bare number with no namespace prefix', () => {
  assert.equal(isBacklogTicketId('590'), false);
});

test('rejects trailing garbage after the digit sequence (the $ anchor matters)', () => {
  assert.equal(isBacklogTicketId('BL-590x'), false);
});

test('rejects leading garbage before the namespace (the ^ anchor matters)', () => {
  assert.equal(isBacklogTicketId('xBL-590'), false);
});

test('rejects undefined', () => {
  assert.equal(isBacklogTicketId(undefined), false);
});

test('rejects the empty string', () => {
  assert.equal(isBacklogTicketId(''), false);
});

// The exported pattern itself is part of the contract (bounceArgsCore.ts
// and qa-sibling-check.ts both import isBacklogTicketId, not this pattern
// directly, but a future caller that DOES read it must find the same
// anchored, case-insensitive, two-namespace shape).
test('BACKLOG_TICKET_ID_PATTERN is anchored, case-insensitive, and names both namespaces', () => {
  assert.equal(BACKLOG_TICKET_ID_PATTERN.source, '^(BL|GH)-\\d+$');
  assert.equal(BACKLOG_TICKET_ID_PATTERN.flags, 'i');
});
