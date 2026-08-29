'use strict';

const assert = require('node:assert/strict');
const {
  advanceNightClosingCeremony,
  briefingInstruction,
} = require('../out/quality/nightClosingCeremonyLive');

function obs(over = {}) {
  return {
    nowMs: 1_000_000,
    nightKey: '2026-08-26',
    dayKey: '2026-08-26',
    ceremonyDue: true,
    drainBudgetMs: 25 * 60_000,
    hardDeadlineMs: 1_000_000 + 35 * 60_000,
    inFlightCount: 1,
    activeRole: 'coder',
    heldParcelIds: [],
    briefingAlreadySent: false,
    ...over,
  };
}

function tick(prev, over = {}) {
  return advanceNightClosingCeremony(prev, obs(over));
}

test('due night freezes promotion and waits for drain', () => {
  const { state, actions } = tick(null);
  assert.equal(state.phase, 'frozen');
  assert.deepEqual(state.sequence, ['freeze-promotion']);
  assert.equal(actions[0].kind, 'freeze');
});

test('already-sent skips briefing and stops', () => {
  const { state, actions } = tick(null, { briefingAlreadySent: true, inFlightCount: 0 });
  assert.equal(state.phase, 'done');
  assert.ok(state.sequence.includes('briefing-already-sent'));
  assert.ok(actions.some((a) => a.kind === 'night-stop'));
  assert.equal(actions.some((a) => a.kind === 'rotate-documenter'), false);
});

test('drain complete at documenter chains without rotate', () => {
  const started = tick(null, { inFlightCount: 1, activeRole: 'documenter' });
  const drained = tick(started.state, {
    nowMs: started.state.startedAtMs + 1000,
    inFlightCount: 0,
    activeRole: 'documenter',
  });
  assert.equal(drained.state.phase, 'briefing');
  assert.ok(drained.state.sequence.includes('parcel-drained'));
  assert.equal(drained.state.rotationRequested, false);
  assert.equal(drained.actions.some((a) => a.kind === 'rotate-documenter'), false);
  assert.ok(drained.actions.some((a) => a.kind === 'instruct-briefing'));
});

test('drain overrun parks and rotates', () => {
  const started = tick(null, { inFlightCount: 1, activeRole: 'coder' });
  const parked = tick(started.state, {
    nowMs: started.state.drainDeadlineMs + 1,
    inFlightCount: 1,
    activeRole: 'coder',
  });
  assert.ok(parked.state.parked);
  assert.ok(parked.state.sequence.includes('parcel-parked'));
  assert.ok(parked.state.loudSurfaces.includes('closing-drain-deadline-exceeded'));
  assert.equal(parked.state.rotationRequested, true);
  assert.ok(parked.actions.some((a) => a.kind === 'rotate-documenter'));
});

test('send confirmed triggers night-stop', () => {
  const started = tick(null, { inFlightCount: 0 });
  const briefing = tick(started.state, {
    nowMs: started.state.startedAtMs + 1,
    inFlightCount: 0,
  });
  const done = tick(briefing.state, {
    nowMs: briefing.state.startedAtMs + 2,
    inFlightCount: 0,
    briefingAlreadySent: true,
  });
  assert.equal(done.state.phase, 'done');
  assert.ok(done.state.sequence.includes('send-confirmed'));
  assert.ok(done.actions.some((a) => a.kind === 'night-stop'));
});

test('hard deadline without send surfaces missing briefing', () => {
  const started = tick(null, { inFlightCount: 0 });
  const briefing = tick(started.state, {
    nowMs: started.state.startedAtMs + 1,
    inFlightCount: 0,
  });
  const missing = tick(briefing.state, {
    nowMs: briefing.state.hardDeadlineMs + 1,
    inFlightCount: 0,
    briefingAlreadySent: false,
  });
  assert.equal(missing.state.phase, 'done');
  assert.ok(missing.state.loudSurfaces.includes('closing-briefing-missing'));
  assert.ok(missing.actions.some((a) => a.kind === 'night-stop'));
});

test('not due does not start', () => {
  const { state, actions } = tick(null, { ceremonyDue: false });
  assert.equal(state.phase, 'idle');
  assert.deepEqual(actions, []);
});

test('briefing instruction is explicit', () => {
  assert.equal(briefingInstruction('2026-08-26'), 'produce the morning briefing for 2026-08-26');
});
