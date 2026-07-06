const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  bounceAckPath,
  readBounceAck,
  writeBounceAck,
  clearBounceAck,
  isBounceRequestStale,
} = require('../out/swarm/bounceAck');

function mkTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bounce-ack-'));
}

test('readBounceAck returns null when no ack file exists', () => {
  const target = mkTarget();
  assert.equal(readBounceAck(target), null);
});

test('writeBounceAck then readBounceAck round-trips', () => {
  const target = mkTarget();
  writeBounceAck(target, {
    bounceType: 'all',
    phase: 'stopping',
    updatedAt: '2026-07-06T09:00:00Z',
    message: 'Stopping swarm before relaunch',
  });
  assert.deepEqual(readBounceAck(target), {
    bounceType: 'all',
    phase: 'stopping',
    updatedAt: '2026-07-06T09:00:00Z',
    message: 'Stopping swarm before relaunch',
  });
});

test('writeBounceAck creates .swarmforge if missing and leaves no temp file behind', () => {
  const target = mkTarget();
  writeBounceAck(target, { bounceType: 'swarm', phase: 'done', updatedAt: '2026-07-06T09:00:00Z' });
  const entries = fs.readdirSync(path.join(target, '.swarmforge'));
  assert.deepEqual(entries, ['bounce-ack.json']);
});

test('readBounceAck returns null for malformed JSON', () => {
  const target = mkTarget();
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  fs.writeFileSync(bounceAckPath(target), 'not json');
  assert.equal(readBounceAck(target), null);
});

test('readBounceAck returns null for an ack missing required fields', () => {
  const target = mkTarget();
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  fs.writeFileSync(bounceAckPath(target), JSON.stringify({ bounceType: 'swarm' }));
  assert.equal(readBounceAck(target), null);
});

test('readBounceAck returns null for an unknown phase value', () => {
  const target = mkTarget();
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    bounceAckPath(target),
    JSON.stringify({ bounceType: 'swarm', phase: 'sleeping', updatedAt: '2026-07-06T09:00:00Z' })
  );
  assert.equal(readBounceAck(target), null);
});

test('clearBounceAck removes the ack file and tolerates it already being absent', () => {
  const target = mkTarget();
  writeBounceAck(target, { bounceType: 'swarm', phase: 'done', updatedAt: '2026-07-06T09:00:00Z' });
  clearBounceAck(target);
  assert.equal(readBounceAck(target), null);
  assert.doesNotThrow(() => clearBounceAck(target));
});

test('writeBounceAck overwrites a previous phase in place', () => {
  const target = mkTarget();
  writeBounceAck(target, { bounceType: 'swarm', phase: 'stopping', updatedAt: '2026-07-06T09:00:00Z' });
  writeBounceAck(target, { bounceType: 'swarm', phase: 'done', updatedAt: '2026-07-06T09:00:05Z' });
  assert.deepEqual(readBounceAck(target), {
    bounceType: 'swarm',
    phase: 'done',
    updatedAt: '2026-07-06T09:00:05Z',
  });
});

// ── isBounceRequestStale (pure, injected clock — no real timers) ──────────

test('isBounceRequestStale is false before the max age elapses', () => {
  assert.equal(isBounceRequestStale(1000, 1000 + 59_000, 60_000), false);
});

test('isBounceRequestStale is true once the max age elapses', () => {
  assert.equal(isBounceRequestStale(1000, 1000 + 60_000, 60_000), true);
});

test('isBounceRequestStale is true well past the max age', () => {
  assert.equal(isBounceRequestStale(0, 600_000, 60_000), true);
});
