/**
 * BL-015: COMMs hole-closing — bug regression tests and new coverage.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createMessage, readLog, claimMessage, appendEventRaw } = require('../out/swarm/messageBus');
const { evaluateChase } = require('../out/chase/ChaseMonitor');
const { computeLiveness } = require('../out/watchdog/liveness');
const { withHeartbeat, resetBeatCount } = require('../out/tools/toolDecorator');
const { pickupPendingMessages } = require('../out/swarm/respawnPickup');
const { isHumanInputMessage, logHumanInput } = require('../out/swarm/humanInput');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl015-'));
}

const CFG = { chaseTimeoutSeconds: 90, maxChases: 3 };
const NOW = new Date('2026-06-29T22:00:00Z').getTime();

// ── BUG: field-name mismatch (type vs event) — integration test ────────────

test('field-name contract: createMessage → readLog → evaluateChase sees created event', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'coder', to: 'cleaner', subject: 'test', body: 'hi', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  const events = readLog(logPath);
  // Message is 100 seconds old
  const oldNow = new Date(events[0].at).getTime() + 100 * 1000;
  const result = evaluateChase(events, oldNow, CFG, 'alive');
  assert.equal(result, 'chased', 'evaluateChase must see type field from messageBus');
});

// ── BUG: NaN date in liveness ──────────────────────────────────────────────

test('liveness: NaN last_beat date → unknown, not alive', () => {
  const hb = { last_beat: 'not-a-date', in_flight: false, last_tool: 'foo', pid: 1, beat_count: 1 };
  const cfg = { staleTimeoutSeconds: 30, inFlightTimeoutSeconds: 60, deadTimeoutSeconds: 120 };
  const result = computeLiveness(hb, NOW, cfg, true);
  assert.equal(result.state, 'unknown');
});

test('liveness: valid date, pid alive → alive', () => {
  const hb = { last_beat: new Date(NOW - 1000).toISOString(), in_flight: false, last_tool: 'foo', pid: 1, beat_count: 1 };
  const cfg = { staleTimeoutSeconds: 30, inFlightTimeoutSeconds: 60, deadTimeoutSeconds: 120 };
  const result = computeLiveness(hb, NOW, cfg, true);
  assert.equal(result.state, 'alive');
});

test('liveness: pid gone even with fresh beat → dead', () => {
  const hb = { last_beat: new Date(NOW - 1000).toISOString(), in_flight: false, last_tool: 'foo', pid: 1, beat_count: 1 };
  const cfg = { staleTimeoutSeconds: 30, inFlightTimeoutSeconds: 60, deadTimeoutSeconds: 120 };
  const result = computeLiveness(hb, NOW, cfg, false);
  assert.equal(result.state, 'dead');
});

// ── BUG: malformed lease string → NaN treated as live ─────────────────────

test('claimMessage: empty claimed_by is claimable', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'a', to: 'b', subject: 's', body: '', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  // Manually append a received event with bad claimed_by
  appendEventRaw(logPath, { type: 'received', by: 'old', at: new Date().toISOString(), claimed_by: '' });
  const now = Math.floor(Date.now() / 1000);
  const ok = claimMessage(logPath, 'new-role', now, 30);
  assert.ok(ok, 'empty claimed_by must be treated as expired/claimable');
});

test('claimMessage: claimed_by with no @-separator is claimable', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'a', to: 'b', subject: 's', body: '', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  appendEventRaw(logPath, { type: 'received', by: 'old', at: new Date().toISOString(), claimed_by: 'alice' });
  const now = Math.floor(Date.now() / 1000);
  const ok = claimMessage(logPath, 'new-role', now, 30);
  assert.ok(ok, 'no-@ claimed_by must be treated as expired');
});

test('claimMessage: claimed_by with trailing @ (NaN epoch) is claimable', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'a', to: 'b', subject: 's', body: '', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  appendEventRaw(logPath, { type: 'received', by: 'old', at: new Date().toISOString(), claimed_by: 'alice@' });
  const now = Math.floor(Date.now() / 1000);
  const ok = claimMessage(logPath, 'new-role', now, 30);
  assert.ok(ok, 'claimed_by with NaN epoch must be treated as expired');
});

test('claimMessage: claimed_by with non-numeric epoch is claimable', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'a', to: 'b', subject: 's', body: '', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  appendEventRaw(logPath, { type: 'received', by: 'old', at: new Date().toISOString(), claimed_by: 'alice@foo' });
  const now = Math.floor(Date.now() / 1000);
  const ok = claimMessage(logPath, 'new-role', now, 30);
  assert.ok(ok, 'non-numeric epoch in claimed_by must be treated as expired');
});

test('claimMessage: claimed_by with double-@ is claimable', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'a', to: 'b', subject: 's', body: '', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  appendEventRaw(logPath, { type: 'received', by: 'old', at: new Date().toISOString(), claimed_by: 'alice@@123' });
  const now = Math.floor(Date.now() / 1000);
  // 'alice@@123'.split('@') → ['alice','','123'], length 3 ≠ 2 → treated as expired
  const ok = claimMessage(logPath, 'new-role', now, 30);
  assert.ok(ok, 'double-@ claimed_by must be treated as expired');
});

// ── BUG: beat_count is module-global ──────────────────────────────────────

test('withHeartbeat: beat_count increments independently per role', async () => {
  const dir = mkTmp();
  resetBeatCount();
  const beats = { A: [], B: [] };

  for (let i = 0; i < 3; i++) {
    withHeartbeat(dir, 'A', 1, 'tool', () => {});
    withHeartbeat(dir, 'B', 2, 'tool', () => {});
  }

  const hbA = require('../out/tools/heartbeat').readHeartbeat(dir, 'A');
  const hbB = require('../out/tools/heartbeat').readHeartbeat(dir, 'B');
  assert.equal(hbA.beat_count, 3, 'role A beat_count must be 3');
  assert.equal(hbB.beat_count, 3, 'role B beat_count must be 3');
});

// ── BUG: withHeartbeat sync-only (async fn) ───────────────────────────────

test('withHeartbeat: writes in_flight:false only after async fn resolves', async () => {
  const dir = mkTmp();
  resetBeatCount('async-role');
  let resolveIt;
  const p = new Promise((res) => { resolveIt = res; });

  const promise = withHeartbeat(dir, 'async-role', 99, 'slowTool', () => p);

  // Before resolving: in_flight should still be true (written on entry)
  const hbDuring = require('../out/tools/heartbeat').readHeartbeat(dir, 'async-role');
  assert.equal(hbDuring.phase, 'entry');
  assert.equal(hbDuring.in_flight, true);

  resolveIt('done');
  await promise;

  const hbAfter = require('../out/tools/heartbeat').readHeartbeat(dir, 'async-role');
  assert.equal(hbAfter.phase, 'exit');
  assert.equal(hbAfter.in_flight, false);
});

test('withHeartbeat: writes in_flight:false after async fn rejects', async () => {
  const dir = mkTmp();
  resetBeatCount('reject-role');

  const promise = withHeartbeat(dir, 'reject-role', 99, 'badTool', async () => {
    await Promise.resolve();
    throw new Error('boom');
  });

  await assert.rejects(() => promise, /boom/);

  const hb = require('../out/tools/heartbeat').readHeartbeat(dir, 'reject-role');
  assert.equal(hb.in_flight, false);
});

// ── BUG: chase skips human-input messages ─────────────────────────────────

test('evaluateChase: skips human-input messages (humanInput=true)', () => {
  const events = [
    { type: 'created', id: 'x', from: 'human', to: 'coder', subject: 'human-input', at: new Date(NOW - 300 * 1000).toISOString() },
  ];
  const result = evaluateChase(events, NOW, CFG, 'alive', true);
  assert.equal(result, 'skipped', 'human-input messages must never be chased');
});

test('isHumanInputMessage returns true for human-input log', () => {
  const dir = mkTmp();
  const id = logHumanInput(dir, 'coder', 'please hurry', 1);
  const logPath = path.join(dir, `${id}.log`);
  assert.equal(isHumanInputMessage(logPath), true);
});

test('isHumanInputMessage returns false for regular message', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'coder', to: 'cleaner', subject: 'done', body: 'ok', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  assert.equal(isHumanInputMessage(logPath), false);
});

// ── BUG: pickup doesn't claim (race) ──────────────────────────────────────

test('pickupPendingMessages: claims message (received event appended)', () => {
  const dir = mkTmp();
  createMessage(dir, { from: 'coder', to: 'cleaner', subject: 'job', body: 'do it', seq: 1 });
  const now = Math.floor(Date.now() / 1000);
  const results = pickupPendingMessages(dir, 'cleaner', now, 300);
  assert.equal(results.length, 1);
  const events = readLog(results[0].logPath);
  const receivedEvents = events.filter((e) => e.type === 'received');
  assert.equal(receivedEvents.length, 1, 'pickup must append a received/claimed event');
});

test('pickupPendingMessages: two parallel calls get disjoint results', () => {
  const dir = mkTmp();
  createMessage(dir, { from: 'coder', to: 'cleaner', subject: 'job', body: 'do it', seq: 1 });
  const now = Math.floor(Date.now() / 1000);
  // First pickup claims
  const r1 = pickupPendingMessages(dir, 'cleaner', now, 300);
  // Second pickup with same time — lease is live, different role attempt
  const r2 = pickupPendingMessages(dir, 'cleaner2', now, 300);
  const ids1 = r1.map((m) => m.id);
  const ids2 = r2.map((m) => m.id);
  const overlap = ids1.filter((id) => ids2.includes(id));
  assert.equal(overlap.length, 0, 'two pickups must not return the same message');
});

test('pickupPendingMessages: skips dead-lettered messages', () => {
  const dir = mkTmp();
  const { appendDeadLetterEvent } = require('../out/chase/ChaseMonitor');
  const id = createMessage(dir, { from: 'coder', to: 'cleaner', subject: 'job', body: 'do it', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  appendDeadLetterEvent(logPath, 3);
  const now = Math.floor(Date.now() / 1000);
  const results = pickupPendingMessages(dir, 'cleaner', now, 300);
  assert.equal(results.length, 0, 'dead-lettered messages must not be picked up');
});

// ── readLog: partial-line tolerance ──────────────────────────────────────

test('readLog: skips truncated/partial JSON lines', () => {
  const dir = mkTmp();
  const logPath = path.join(dir, 'partial.log');
  const good = JSON.stringify({ type: 'created', at: new Date().toISOString() });
  const partial = '{"type":"received","at":"2026-06'; // truncated
  fs.writeFileSync(logPath, good + '\n' + partial, 'utf8');
  const events = readLog(logPath);
  assert.equal(events.length, 1, 'only the complete line should be parsed');
  assert.equal(events[0].type, 'created');
});

// ── BUG: chase re-interval (gate on last chase, not created) ──────────────

test('evaluateChase: does not re-chase if last chase is too recent', () => {
  const recentChaseAt = new Date(NOW - 30 * 1000).toISOString(); // 30s ago
  const events = [
    { type: 'created', id: 'x', from: 'coder', to: 'cleaner', subject: 'test', at: new Date(NOW - 400 * 1000).toISOString() },
    { type: 'chased', chase_count: 1, at: recentChaseAt },
  ];
  // chaseTimeoutSeconds=90, last chase was 30s ago → too soon
  const result = evaluateChase(events, NOW, CFG, 'alive');
  assert.equal(result, 'skipped', 'must not re-chase within chaseTimeoutSeconds of last chase');
});

test('evaluateChase: re-chases after sufficient time since last chase', () => {
  const oldChaseAt = new Date(NOW - 120 * 1000).toISOString(); // 120s ago
  const events = [
    { type: 'created', id: 'x', from: 'coder', to: 'cleaner', subject: 'test', at: new Date(NOW - 400 * 1000).toISOString() },
    { type: 'chased', chase_count: 1, at: oldChaseAt },
  ];
  const result = evaluateChase(events, NOW, CFG, 'alive');
  assert.equal(result, 'chased');
});

// ── BUG: appendEventRaw concurrent write safety ───────────────────────────

test('appendEventRaw: concurrent writes from two async paths both land in log', async () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'a', to: 'b', subject: 's', body: '', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);

  // Simulate two concurrent appends (in the same process, interleaved via Promise.all)
  await Promise.all([
    Promise.resolve().then(() => appendEventRaw(logPath, { type: 'chased', n: 1, at: new Date().toISOString() })),
    Promise.resolve().then(() => appendEventRaw(logPath, { type: 'chased', n: 2, at: new Date().toISOString() })),
  ]);

  const events = readLog(logPath);
  const chased = events.filter((e) => e.type === 'chased');
  assert.equal(chased.length, 2, 'both concurrent appends must survive');
});

// ── claimMessage: idempotent re-ack own live lease ─────────────────────────

test('claimMessage: idempotent — same claimer re-acking live lease does not duplicate received', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'a', to: 'b', subject: 's', body: '', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  const now = Math.floor(Date.now() / 1000);
  claimMessage(logPath, 'cleaner', now, 300);
  claimMessage(logPath, 'cleaner', now, 300);
  const events = readLog(logPath);
  const received = events.filter((e) => e.type === 'received');
  assert.equal(received.length, 1, 'idempotent re-claim must not append duplicate received event');
});
