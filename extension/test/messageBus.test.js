const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createMessage,
  claimMessage,
  completeMessage,
  appendEventRaw,
  readLog,
  currentStatus,
} = require('../out/swarm/messageBus');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bus-'));
}

// ── createMessage ──────────────────────────────────────────────────────────

test('createMessage writes a log file with a created event', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'coder', to: 'cleaner', subject: 'done', body: 'all good', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  assert.ok(fs.existsSync(logPath));
  const events = readLog(logPath);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'created');
  assert.equal(events[0].from, 'coder');
  assert.equal(events[0].to, 'cleaner');
  assert.equal(events[0].subject, 'done');
  assert.equal(events[0].body, 'all good');
  assert.equal(events[0].seq, 1);
  assert.equal(events[0].schema, 1);
  assert.ok(typeof events[0].at === 'string');
});

test('createMessage returns a stable id matching the filename', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'a', to: 'b', subject: 's', body: '', seq: 0 });
  assert.ok(fs.existsSync(path.join(dir, `${id}.log`)));
});

test('createMessage with same seq for different ids produces different filenames', () => {
  const dir = mkTmp();
  const id1 = createMessage(dir, { from: 'a', to: 'b', subject: 's1', body: '', seq: 1 });
  const id2 = createMessage(dir, { from: 'a', to: 'b', subject: 's2', body: '', seq: 2 });
  assert.notEqual(id1, id2);
});

// ── currentStatus ──────────────────────────────────────────────────────────

test('currentStatus returns created after message creation', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'a', to: 'b', subject: 's', body: '', seq: 1 });
  const status = currentStatus(path.join(dir, `${id}.log`));
  assert.equal(status, 'created');
});

// ── claimMessage ───────────────────────────────────────────────────────────

test('claimMessage appends received event and changes status', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'a', to: 'b', subject: 's', body: '', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  const now = Math.floor(Date.now() / 1000);
  const ok = claimMessage(logPath, 'cleaner', now, 300);
  assert.ok(ok);
  assert.equal(currentStatus(logPath), 'received');
  const events = readLog(logPath);
  assert.equal(events.length, 2);
  assert.equal(events[1].type, 'received');
  assert.equal(events[1].by, 'cleaner');
  assert.ok(events[1].claimed_by.startsWith('cleaner@'));
});

test('claimMessage is idempotent when same claimer already holds live lease', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'a', to: 'b', subject: 's', body: '', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  const now = Math.floor(Date.now() / 1000);
  claimMessage(logPath, 'cleaner', now, 300);
  const ok2 = claimMessage(logPath, 'cleaner', now, 300);
  assert.ok(ok2); // idempotent for same claimer
  const events = readLog(logPath);
  assert.equal(events.filter(e => e.type === 'received').length, 1);
});

test('claimMessage is rejected when a different claimer holds a live lease', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'a', to: 'b', subject: 's', body: '', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  const now = Math.floor(Date.now() / 1000);
  claimMessage(logPath, 'cleaner', now, 300);
  const ok2 = claimMessage(logPath, 'QA', now, 300);
  assert.equal(ok2, false);
});

test('claimMessage succeeds when previous lease is stale', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'a', to: 'b', subject: 's', body: '', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  const pastEpoch = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
  claimMessage(logPath, 'cleaner', pastEpoch, 300); // lease already expired
  const nowEpoch = Math.floor(Date.now() / 1000);
  const ok2 = claimMessage(logPath, 'QA', nowEpoch, 300);
  assert.ok(ok2);
  assert.equal(currentStatus(logPath), 'received');
});

// ── completeMessage ────────────────────────────────────────────────────────

test('completeMessage appends done event and changes status', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'a', to: 'b', subject: 's', body: '', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  const now = Math.floor(Date.now() / 1000);
  claimMessage(logPath, 'cleaner', now, 300);
  completeMessage(logPath, 'cleaner');
  assert.equal(currentStatus(logPath), 'done');
  const events = readLog(logPath);
  assert.equal(events[2].type, 'done');
  assert.equal(events[2].by, 'cleaner');
});

// ── full handoff replay ────────────────────────────────────────────────────

test('two simulated processes: full handoff history is preserved', () => {
  const dir = mkTmp();
  // process 1: sender creates message
  const id = createMessage(dir, { from: 'coder', to: 'cleaner', subject: 'BL-009', body: 'commit abc', seq: 42 });
  const logPath = path.join(dir, `${id}.log`);

  // process 2: receiver claims and completes
  const now = Math.floor(Date.now() / 1000);
  claimMessage(logPath, 'cleaner', now, 300);
  completeMessage(logPath, 'cleaner');

  const events = readLog(logPath);
  assert.equal(events.length, 3);
  assert.equal(events[0].type, 'created');
  assert.equal(events[1].type, 'received');
  assert.equal(events[2].type, 'done');
  assert.equal(currentStatus(logPath), 'done');
});

// ── atomic write ──────────────────────────────────────────────────────────

test('atomic write: no partial file visible (temp+rename)', () => {
  const dir = mkTmp();
  // After createMessage, only the final .log file should exist — no .tmp
  const id = createMessage(dir, { from: 'a', to: 'b', subject: 's', body: '', seq: 1 });
  const tmpFiles = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
  assert.equal(tmpFiles.length, 0);
  assert.ok(fs.existsSync(path.join(dir, `${id}.log`)));
});

// ── appendEventRaw (internal helper used by CLI tools) ────────────────────

test('appendEventRaw appends a custom event atomically', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'a', to: 'b', subject: 's', body: '', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  appendEventRaw(logPath, { type: 'chased', by: 'coordinator', at: new Date().toISOString() });
  const events = readLog(logPath);
  assert.equal(events.length, 2);
  assert.equal(events[1].type, 'chased');
});
