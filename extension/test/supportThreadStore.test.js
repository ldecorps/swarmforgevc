const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readThread, writeThread, appendMessage } = require('../out/bridge/supportThreadStore');

// BL-281: the bridge-side (TS) read/write for the SAME SUP-### thread
// store support_thread_store.bb (Babashka) owns - proves the two sides
// agree on the exact file shape/location by reading back what this module
// itself just wrote (byte-compatible with support_thread.bb's own output,
// verified separately by BL-275's acceptance suite).

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-support-thread-store-'));
}

test('appendMessage opens a fresh thread (status open) when none exists yet', () => {
  const thread = appendMessage(null, 'SUP-1', 'telegram', '2026-07-11T09:00:00Z', 'about A');
  assert.deepEqual(thread, {
    id: 'SUP-1',
    status: 'open',
    messages: [{ channel: 'telegram', timestamp: '2026-07-11T09:00:00Z', text: 'about A' }],
  });
});

test('appendMessage appends to an EXISTING thread, preserving prior messages and status', () => {
  const existing = { id: 'SUP-1', status: 'open', messages: [{ channel: 'telegram', timestamp: 't1', text: 'first' }] };
  const updated = appendMessage(existing, 'SUP-1', 'telegram', 't2', 'second');
  assert.equal(updated.messages.length, 2);
  assert.deepEqual(updated.messages[1], { channel: 'telegram', timestamp: 't2', text: 'second' });
  assert.equal(updated.status, 'open');
});

test('writeThread then readThread round-trips exactly', () => {
  const targetPath = mkTmp();
  const thread = { id: 'SUP-7', status: 'open', messages: [{ channel: 'telegram', timestamp: 't1', text: 'hi' }] };
  writeThread(targetPath, thread);
  assert.deepEqual(readThread(targetPath, 'SUP-7'), thread);
});

test('readThread returns null for a thread that does not exist, not an error', () => {
  const targetPath = mkTmp();
  assert.equal(readThread(targetPath, 'SUP-999'), null);
});

test('writeThread persists under the SAME path support_thread_store.bb reads (.swarmforge/support/threads/<id>.json)', () => {
  const targetPath = mkTmp();
  writeThread(targetPath, { id: 'SUP-3', status: 'open', messages: [] });
  const expectedPath = path.join(targetPath, '.swarmforge', 'support', 'threads', 'SUP-3.json');
  assert.ok(fs.existsSync(expectedPath), `expected the thread file at ${expectedPath}`);
});
