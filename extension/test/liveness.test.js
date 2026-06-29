const assert = require('node:assert/strict');
const test = require('node:test');

const { computeLiveness } = require('../out/watchdog/liveness');

const CFG = { staleTimeoutSeconds: 60, inFlightTimeoutSeconds: 600, deadTimeoutSeconds: 180 };
const NOW = new Date('2026-06-29T21:00:00Z').getTime();

function beat(overrides = {}) {
  return {
    last_beat: '2026-06-29T21:00:00Z',
    in_flight: false,
    last_tool: 'write_file',
    pid: 1234,
    beat_count: 1,
    ...overrides,
  };
}

function ageMs(seconds) {
  return NOW - seconds * 1000;
}

// ── unknown ───────────────────────────────────────────────────────────────

test('undefined heartbeat → unknown', () => {
  const r = computeLiveness(undefined, NOW, CFG, false);
  assert.equal(r.state, 'unknown');
});

// ── alive ─────────────────────────────────────────────────────────────────

test('recent heartbeat, pid alive → alive', () => {
  const r = computeLiveness(beat({ last_beat: new Date(NOW - 5000).toISOString() }), NOW, CFG, true);
  assert.equal(r.state, 'alive');
});

test('in_flight, pid alive, not yet stuck → alive', () => {
  const r = computeLiveness(beat({ in_flight: true, last_beat: new Date(NOW - 10000).toISOString() }), NOW, CFG, true);
  assert.equal(r.state, 'alive');
});

// ── idle ─────────────────────────────────────────────────────────────────

test('not in_flight, age > staleTimeout, pid alive → idle', () => {
  const r = computeLiveness(beat({ last_beat: new Date(NOW - 90 * 1000).toISOString() }), NOW, CFG, true);
  assert.equal(r.state, 'idle');
  assert.equal(r.label, 'idle');
});

// ── dead ─────────────────────────────────────────────────────────────────

test('pid not alive → dead', () => {
  const r = computeLiveness(beat({ last_beat: new Date(NOW - 5000).toISOString() }), NOW, CFG, false);
  assert.equal(r.state, 'dead');
});

test('not in_flight, age > deadTimeout, pid alive → dead', () => {
  const r = computeLiveness(beat({ last_beat: new Date(NOW - 200 * 1000).toISOString() }), NOW, CFG, true);
  assert.equal(r.state, 'dead');
});

// ── stuck ─────────────────────────────────────────────────────────────────

test('in_flight, age > inFlightTimeout, pid alive → stuck', () => {
  const r = computeLiveness(beat({ in_flight: true, last_tool: 'slow_op', last_beat: new Date(NOW - 700 * 1000).toISOString() }), NOW, CFG, true);
  assert.equal(r.state, 'stuck');
  assert.ok(r.label.includes('slow_op'));
});

test('in_flight + pid dead → dead not stuck', () => {
  const r = computeLiveness(beat({ in_flight: true, last_beat: new Date(NOW - 700 * 1000).toISOString() }), NOW, CFG, false);
  assert.equal(r.state, 'dead');
});
