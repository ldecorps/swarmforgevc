const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { evaluateChase, appendChaseEvent } = require('../out/chase/ChaseMonitor');
const { createMessage, readLog, currentStatus } = require('../out/swarm/messageBus');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-chase-'));
}

const CFG = { chaseTimeoutSeconds: 90, maxChases: 3 };
const NOW = new Date('2026-06-29T22:00:00Z').getTime();

function createdEvent(at) {
  return { event: 'created', id: 'x', from: 'coder', to: 'cleaner', subject: 'test', at };
}

// ── evaluateChase (pure) ──────────────────────────────────────────────────

test('empty events → skipped', () => {
  assert.equal(evaluateChase([], NOW, CFG, 'alive'), 'skipped');
});

test('message too young → skipped', () => {
  const events = [createdEvent(new Date(NOW - 10 * 1000).toISOString())];
  assert.equal(evaluateChase(events, NOW, CFG, 'alive'), 'skipped');
});

test('message old enough, receiver alive, 0 chases → chased', () => {
  const events = [createdEvent(new Date(NOW - 120 * 1000).toISOString())];
  assert.equal(evaluateChase(events, NOW, CFG, 'alive'), 'chased');
});

test('message old enough, receiver idle, 0 chases → chased', () => {
  const events = [createdEvent(new Date(NOW - 120 * 1000).toISOString())];
  assert.equal(evaluateChase(events, NOW, CFG, 'idle'), 'chased');
});

test('receiver dead → skipped (no chase)', () => {
  const events = [createdEvent(new Date(NOW - 120 * 1000).toISOString())];
  assert.equal(evaluateChase(events, NOW, CFG, 'dead'), 'skipped');
});

test('receiver stuck → skipped', () => {
  const events = [createdEvent(new Date(NOW - 120 * 1000).toISOString())];
  assert.equal(evaluateChase(events, NOW, CFG, 'stuck'), 'skipped');
});

test('receiver unknown → skipped', () => {
  const events = [createdEvent(new Date(NOW - 120 * 1000).toISOString())];
  assert.equal(evaluateChase(events, NOW, CFG, 'unknown'), 'skipped');
});

test('message already received → already-done', () => {
  const events = [
    createdEvent(new Date(NOW - 120 * 1000).toISOString()),
    { event: 'received', by: 'cleaner', at: new Date(NOW - 5000).toISOString() },
  ];
  assert.equal(evaluateChase(events, NOW, CFG, 'alive'), 'already-done');
});

test('message already done → already-done', () => {
  const events = [
    createdEvent(new Date(NOW - 120 * 1000).toISOString()),
    { event: 'done', by: 'cleaner', at: new Date(NOW - 5000).toISOString() },
  ];
  assert.equal(evaluateChase(events, NOW, CFG, 'alive'), 'already-done');
});

test('already dead-letter → already-done', () => {
  const events = [
    createdEvent(new Date(NOW - 200 * 1000).toISOString()),
    { event: 'dead-letter', chase_count: 3, at: new Date(NOW - 10000).toISOString() },
  ];
  assert.equal(evaluateChase(events, NOW, CFG, 'alive'), 'already-done');
});

test('maxChases reached → dead-lettered', () => {
  const events = [
    createdEvent(new Date(NOW - 400 * 1000).toISOString()),
    { event: 'chased', chase_count: 1, at: new Date(NOW - 300 * 1000).toISOString() },
    { event: 'chased', chase_count: 2, at: new Date(NOW - 200 * 1000).toISOString() },
    { event: 'chased', chase_count: 3, at: new Date(NOW - 100 * 1000).toISOString() },
  ];
  assert.equal(evaluateChase(events, NOW, CFG, 'alive'), 'dead-lettered');
});

test('2 chases, not at max → chased again', () => {
  const events = [
    createdEvent(new Date(NOW - 400 * 1000).toISOString()),
    { event: 'chased', chase_count: 1, at: new Date(NOW - 200 * 1000).toISOString() },
    { event: 'chased', chase_count: 2, at: new Date(NOW - 100 * 1000).toISOString() },
  ];
  assert.equal(evaluateChase(events, NOW, CFG, 'alive'), 'chased');
});

// ── appendChaseEvent (integration with messageBus) ───────────────────────

test('appendChaseEvent writes chased event to log', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'coder', to: 'cleaner', subject: 'test', body: '', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  appendChaseEvent(logPath, 1);
  const events = readLog(logPath);
  assert.equal(events.length, 2);
  assert.equal(events[1].type, 'chased');
  assert.equal(events[1].chase_count, 1);
});

test('appendChaseEvent writes dead-letter event to log', () => {
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'coder', to: 'cleaner', subject: 'test', body: '', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  appendChaseEvent(logPath, 1);
  appendChaseEvent(logPath, 2);
  appendChaseEvent(logPath, 3);
  // Now dead-letter
  const { appendDeadLetterEvent } = require('../out/chase/ChaseMonitor');
  appendDeadLetterEvent(logPath, 3);
  assert.equal(currentStatus(logPath), 'dead-letter');
  const events = readLog(logPath);
  const dl = events.find(e => e.type === 'dead-letter');
  assert.ok(dl);
  assert.equal(dl.chase_count, 3);
});
