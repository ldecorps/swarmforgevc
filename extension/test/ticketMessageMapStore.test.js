const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { ticketMessageMapPath, readTicketMessageMap, writeTicketMessageMap, writeTicketMessageEntry } = require('../out/concierge/ticketMessageMapStore');

// BL-493: the machine-local, gitignored per-ticket edit-in-place message
// identity store (ticket-id -> {topicId, messageId, renderedText}) - read
// AND written by the swarm itself, mirrors backlogTopicMapStore.ts's own
// read-with-empty-default/atomic-write shape rather than epicTopicMapStore's
// read-only one.

function mkTmp() {
  return mkTmpDir('sfvc-ticket-message-map-');
}

test('ticketMessageMapPath resolves under .swarmforge/operator/', () => {
  const target = mkTmp();
  assert.equal(ticketMessageMapPath(target), path.join(target, '.swarmforge', 'operator', 'ticket-message-map.json'));
});

test('readTicketMessageMap returns an empty map when the file does not exist', () => {
  const target = mkTmp();
  assert.deepEqual(readTicketMessageMap(target), {});
});

test('readTicketMessageMap returns an empty map for corrupt JSON, never throws', () => {
  const target = mkTmp();
  fs.mkdirSync(path.dirname(ticketMessageMapPath(target)), { recursive: true });
  fs.writeFileSync(ticketMessageMapPath(target), 'not json');

  assert.doesNotThrow(() => readTicketMessageMap(target));
  assert.deepEqual(readTicketMessageMap(target), {});
});

test('readTicketMessageMap returns the parsed map when the file exists', () => {
  const target = mkTmp();
  fs.mkdirSync(path.dirname(ticketMessageMapPath(target)), { recursive: true });
  fs.writeFileSync(
    ticketMessageMapPath(target),
    JSON.stringify({ 'BL-123': { topicId: 42, messageId: 900, renderedText: 'BL-123 🎵 in progress — a fine feature' } })
  );

  assert.deepEqual(readTicketMessageMap(target), {
    'BL-123': { topicId: 42, messageId: 900, renderedText: 'BL-123 🎵 in progress — a fine feature' },
  });
});

// break-then-fix (engineering.prompt's new-disk-input rule): prove the
// write path is genuinely load-bearing by writing through it, then reading
// back via a COMPLETELY SEPARATE read call against the same real path - a
// read that only ever returned an in-memory fixture would not prove this.
test('writeTicketMessageMap persists to disk - a later, independent readTicketMessageMap call sees it (break-then-fix: absent before, present after)', () => {
  const target = mkTmp();
  assert.deepEqual(readTicketMessageMap(target), {}, 'BROKEN (absent) before any write');

  writeTicketMessageMap(target, { 'BL-1': { topicId: 10, messageId: 100, renderedText: 'BL-1 ✅ done — first' } });

  assert.deepEqual(readTicketMessageMap(target), { 'BL-1': { topicId: 10, messageId: 100, renderedText: 'BL-1 ✅ done — first' } }, 'FIXED (present) after the write');
});

test('writeTicketMessageEntry sets exactly one ticket entry without disturbing the others', () => {
  const target = mkTmp();
  writeTicketMessageMap(target, { 'BL-1': { topicId: 10, messageId: 100, renderedText: 'BL-1 🎵 in progress — first' } });

  writeTicketMessageEntry(target, 'BL-2', { topicId: 20, messageId: 200, renderedText: 'BL-2 🎵 in progress — second' });

  assert.deepEqual(readTicketMessageMap(target), {
    'BL-1': { topicId: 10, messageId: 100, renderedText: 'BL-1 🎵 in progress — first' },
    'BL-2': { topicId: 20, messageId: 200, renderedText: 'BL-2 🎵 in progress — second' },
  });
});

test('writeTicketMessageEntry overwrites an existing ticket entry (edit-in-place transition)', () => {
  const target = mkTmp();
  writeTicketMessageEntry(target, 'BL-1', { topicId: 10, messageId: 100, renderedText: 'BL-1 🎵 in progress — first' });

  writeTicketMessageEntry(target, 'BL-1', { topicId: 10, messageId: 100, renderedText: 'BL-1 ✅ done — first' });

  assert.deepEqual(readTicketMessageMap(target), { 'BL-1': { topicId: 10, messageId: 100, renderedText: 'BL-1 ✅ done — first' } });
});
