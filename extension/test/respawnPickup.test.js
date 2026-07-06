'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createMessage, claimMessage, completeMessage, appendEventRaw } = require('../out/swarm/messageBus');
const { pickupPendingMessages } = require('../out/swarm/respawnPickup');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-respawn-'));
}

// ── pickupPendingMessages ──────────────────────────────────────────────────

test('returns message in created state addressed to role', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'coder', to: 'cleaner', subject: 'work', body: 'do it', seq: 1 });
  const results = pickupPendingMessages(dir, 'cleaner', Math.floor(Date.now() / 1000), 300);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, id);
});

test('returns message in received state with stale lease', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'coder', to: 'cleaner', subject: 'work', body: 'do it', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  const pastEpoch = Math.floor(Date.now() / 1000) - 600;
  claimMessage(logPath, 'cleaner', pastEpoch, 300);
  const results = pickupPendingMessages(dir, 'cleaner', Math.floor(Date.now() / 1000), 300);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, id);
});

test('does NOT return message with live lease held by another claimer', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'coder', to: 'cleaner', subject: 'work', body: 'do it', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  const now = Math.floor(Date.now() / 1000);
  claimMessage(logPath, 'cleaner', now, 300);
  const results = pickupPendingMessages(dir, 'cleaner', now, 300);
  assert.equal(results.length, 0);
});

test('does NOT return done messages', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'coder', to: 'cleaner', subject: 'work', body: 'do it', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  const now = Math.floor(Date.now() / 1000);
  claimMessage(logPath, 'cleaner', now, 300);
  completeMessage(logPath, 'cleaner');
  const results = pickupPendingMessages(dir, 'cleaner', now, 300);
  assert.equal(results.length, 0);
});

test('does NOT return messages addressed to a different role', () => {
  const dir = mkTmp();
  createMessage(dir, { from: 'coder', to: 'QA', subject: 'work', body: 'do it', seq: 1 });
  const results = pickupPendingMessages(dir, 'cleaner', Math.floor(Date.now() / 1000), 300);
  assert.equal(results.length, 0);
});

test('returns multiple claimable messages', () => {
  const dir = mkTmp();
  createMessage(dir, { from: 'coder', to: 'cleaner', subject: 'a', body: '1', seq: 1 });
  createMessage(dir, { from: 'coder', to: 'cleaner', subject: 'b', body: '2', seq: 2 });
  const results = pickupPendingMessages(dir, 'cleaner', Math.floor(Date.now() / 1000), 300);
  assert.equal(results.length, 2);
});

test('returns id, status, and body for each claimable message', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'coder', to: 'cleaner', subject: 'work', body: 'payload text', seq: 1 });
  const results = pickupPendingMessages(dir, 'cleaner', Math.floor(Date.now() / 1000), 300);
  assert.equal(results[0].id, id);
  assert.equal(results[0].status, 'received');
  assert.equal(results[0].body, 'payload text');
});

test('returns an empty array when the directory does not exist', () => {
  const dir = path.join(mkTmp(), 'does-not-exist');
  const results = pickupPendingMessages(dir, 'cleaner', Math.floor(Date.now() / 1000), 300);
  assert.deepEqual(results, []);
});

test('does NOT return dead-lettered messages', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'coder', to: 'cleaner', subject: 'work', body: 'do it', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  appendEventRaw(logPath, { type: 'dead-letter', by: 'chaser' });
  const results = pickupPendingMessages(dir, 'cleaner', Math.floor(Date.now() / 1000), 300);
  assert.equal(results.length, 0);
});
