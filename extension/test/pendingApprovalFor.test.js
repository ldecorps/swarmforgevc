const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { findTicketFilePath, ticketFileExists } = require('../out/concierge/pendingApprovalFor');

// BL-1190: the canonical existence check a ghost approval ask (BL-1186) is
// missing - matched by the ticket's own `id:` field, never a filename guess.

function writeTicket(root, folder, filename, id) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), `id: ${id}\ntitle: t\nhuman_approval: pending\n`);
}

test('findTicketFilePath: finds a ticket in backlog/active by its id: field', () => {
  const root = mkTmpDir('bl1190-pending-for-');
  writeTicket(root, 'active', 'BL-1190-slug.yaml', 'BL-1190');
  const found = findTicketFilePath(root, 'BL-1190');
  assert.equal(found, path.join(root, 'backlog', 'active', 'BL-1190-slug.yaml'));
});

test('findTicketFilePath: finds a ticket in backlog/paused by its id: field', () => {
  const root = mkTmpDir('bl1190-pending-for-');
  writeTicket(root, 'paused', 'BL-1190-slug.yaml', 'BL-1190');
  const found = findTicketFilePath(root, 'BL-1190');
  assert.equal(found, path.join(root, 'backlog', 'paused', 'BL-1190-slug.yaml'));
});

test('findTicketFilePath: undefined when no yaml carries the id, even with other tickets present', () => {
  const root = mkTmpDir('bl1190-pending-for-');
  writeTicket(root, 'active', 'BL-1.yaml', 'BL-1');
  writeTicket(root, 'paused', 'BL-2.yaml', 'BL-2');
  assert.equal(findTicketFilePath(root, 'BL-1190'), undefined);
});

test('findTicketFilePath: undefined when the backlog folders do not exist at all', () => {
  const root = mkTmpDir('bl1190-pending-for-');
  assert.equal(findTicketFilePath(root, 'BL-1190'), undefined);
});

test('findTicketFilePath: never matches backlog/done (a ticket cannot be un-closed by an ask)', () => {
  const root = mkTmpDir('bl1190-pending-for-');
  writeTicket(root, 'done', 'BL-1190.yaml', 'BL-1190');
  assert.equal(findTicketFilePath(root, 'BL-1190'), undefined);
});

test('ticketFileExists: true/false mirror findTicketFilePath', () => {
  const root = mkTmpDir('bl1190-pending-for-');
  writeTicket(root, 'active', 'BL-1190-slug.yaml', 'BL-1190');
  assert.equal(ticketFileExists(root, 'BL-1190'), true);
  assert.equal(ticketFileExists(root, 'BL-9999'), false);
});
