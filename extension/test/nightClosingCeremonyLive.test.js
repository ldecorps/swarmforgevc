'use strict';

const assert = require('node:assert/strict');
const {
  advanceNightClosingCeremony,
  briefingInstruction,
  sleepLoopDecision,
  SLEEP_CEILING_GRACE_MS,
  withForcedBriefingStep,
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

// ── BL-1641: the deadline gives the executor a chance to ensure a briefing ──

test('BL-1641: the hard deadline emits ensure-briefing before surface and night-stop', () => {
  const started = tick(null, { inFlightCount: 0 });
  const briefing = tick(started.state, { nowMs: started.state.startedAtMs + 1, inFlightCount: 0 });
  const missing = tick(briefing.state, {
    nowMs: briefing.state.hardDeadlineMs + 1,
    inFlightCount: 0,
    briefingAlreadySent: false,
  });
  const kinds = missing.actions.map((a) => a.kind);
  assert.ok(kinds.includes('ensure-briefing'), `no ensure-briefing action: ${kinds.join(', ')}`);
  const ensureAt = kinds.indexOf('ensure-briefing');
  assert.ok(ensureAt < kinds.indexOf('surface'), 'ensure-briefing must precede surface');
  assert.ok(ensureAt < kinds.indexOf('night-stop'), 'ensure-briefing must precede night-stop');
  const dayKeyAction = missing.actions.find((a) => a.kind === 'ensure-briefing');
  assert.equal(dayKeyAction.dayKey, '2026-08-26');
});

test('BL-1641: an already-sent briefing never emits ensure-briefing (nothing to ensure)', () => {
  const started = tick(null, { inFlightCount: 0 });
  const briefing = tick(started.state, { nowMs: started.state.startedAtMs + 1, inFlightCount: 0 });
  const sent = tick(briefing.state, {
    nowMs: briefing.state.hardDeadlineMs - 1,
    inFlightCount: 0,
    briefingAlreadySent: true,
  });
  assert.ok(!sent.actions.some((a) => a.kind === 'ensure-briefing'));
});

// ── BL-1641: withForcedBriefingStep folds the executor's outcome in ──────

test('withForcedBriefingStep: inserts the forced step right before swarm-stopped', () => {
  const state = { ...doneState(), sequence: ['freeze-promotion', 'briefing-missing', 'swarm-stopped'] };
  const next = withForcedBriefingStep(state, 'briefing-landed-from-documenter');
  assert.deepEqual(next.sequence, [
    'freeze-promotion',
    'briefing-missing',
    'briefing-landed-from-documenter',
    'swarm-stopped',
  ]);
});

test('withForcedBriefingStep: a null forced step leaves the sequence untouched (same reference)', () => {
  const state = { ...doneState(), sequence: ['freeze-promotion', 'briefing-missing', 'swarm-stopped'] };
  const next = withForcedBriefingStep(state, null);
  assert.equal(next, state);
});

test('withForcedBriefingStep: appends when swarm-stopped is absent, never throws', () => {
  const state = { ...doneState(), sequence: ['freeze-promotion'] };
  const next = withForcedBriefingStep(state, 'briefing-composed-headless');
  assert.deepEqual(next.sequence, ['freeze-promotion', 'briefing-composed-headless']);
});

test('not due does not start', () => {
  const { state, actions } = tick(null, { ceremonyDue: false });
  assert.equal(state.phase, 'idle');
  assert.deepEqual(actions, []);
});

test('briefing instruction is explicit', () => {
  assert.equal(briefingInstruction('2026-08-26'), 'produce the morning briefing for 2026-08-26');
});

// ── BL-1393: one ceremony, with the lean pass as a step inside it ─────────
//
// BL-658's sequence and BL-820's lean pass were two mechanisms with two
// triggers: the daemon's overnight window ran the ceremony without the lean
// pass, and finish-shift ran the lean pass without the drain, the briefing or
// the email - so a weekday bedtime, the ordinary way this swarm sleeps, got
// the lean pass alone and the full ceremony never ran on a weekday at all.
// The human's directive: "820 should be part of 658. the closing ceremony
// should happen each time the swarm does at least 1 shift and goes to sleep."

test('BL-1393: the lean packet is a step between the drain and the briefing', () => {
  const frozen = tick(null).state;
  const { state, actions } = advanceNightClosingCeremony(frozen, obs({ inFlightCount: 0 }));

  const leanAt = state.sequence.indexOf('lean-packet');
  assert.notEqual(leanAt, -1, `the sequence has no lean step: ${state.sequence.join(' -> ')}`);
  assert.ok(
    leanAt > state.sequence.indexOf('parcel-drained'),
    'the lean packet must come after the drain',
  );
  assert.ok(
    leanAt < state.sequence.indexOf('rotate-documenter'),
    'the lean packet must come before the briefing is instructed',
  );

  const kinds = actions.map((a) => a.kind);
  assert.ok(kinds.includes('lean-packet'), `no lean-packet action: ${kinds.join(', ')}`);
  assert.ok(
    kinds.indexOf('lean-packet') < kinds.indexOf('instruct-briefing'),
    'the lean packet must be delivered before the briefing is instructed',
  );
});

test('BL-1393: a sleep with no shift of work records an empty outcome and sends no briefing', () => {
  const { state, actions } = tick(null, { workedAShift: false, inFlightCount: 0 });

  assert.equal(state.phase, 'done');
  assert.ok(
    state.sequence.includes('no-shift-since-last-ceremony'),
    `the sequence must say why it stopped: ${state.sequence.join(' -> ')}`,
  );
  const kinds = actions.map((a) => a.kind);
  assert.ok(kinds.includes('record-empty-outcome'), 'the empty outcome must be recorded explicitly');
  assert.ok(kinds.includes('night-stop'), 'the swarm still goes to sleep');
  assert.ok(!kinds.includes('instruct-briefing'), 'no briefing is instructed');
  assert.ok(!kinds.includes('lean-packet'), 'no packet is delivered');
});

test('BL-1393: a shift of work is the default, so the ordinary night is unchanged', () => {
  // workedAShift omitted entirely: every existing caller and every test above
  // must keep the behaviour BL-658 shipped.
  const { state } = tick(null);
  assert.equal(state.phase, 'frozen');
  assert.deepEqual(state.sequence, ['freeze-promotion']);
});

// ── BL-1640: a second sleep after a worked shift reopens a done night ────

function doneState(over = {}) {
  return {
    nightKey: '2026-08-26',
    phase: 'done',
    sequence: ['freeze-promotion', 'lean-packet', 'briefing-already-sent'],
    startedAtMs: 500_000,
    drainDeadlineMs: 500_000,
    hardDeadlineMs: 900_000,
    rotationRequested: false,
    loudSurfaces: [],
    parked: false,
    briefingInstructed: false,
    hadInFlight: false,
    ...over,
  };
}

test('BL-1640: a sleep after a worked shift reopens a same-night done state as a new ceremony', () => {
  const done = doneState();
  const { state, actions } = tick(done, { fromSleep: true, workedAShift: true, inFlightCount: 0 });
  assert.equal(state.phase, 'frozen');
  assert.deepEqual(state.sequence, ['freeze-promotion']);
  assert.equal(state.startedAtMs, 1_000_000, 'the new ceremony starts at the new sleep time');
  assert.ok(actions.some((a) => a.kind === 'freeze'));
});

test('BL-1640: a sleep with no shift since stays quiet over a same-night done state', () => {
  const done = doneState();
  const { state, actions } = tick(done, { fromSleep: true, workedAShift: false });
  assert.equal(state, done, 'the state must be the SAME unchanged object, not a rebuilt copy');
  assert.deepEqual(actions, []);
});

test('BL-1640: the daemon sweep never reopens a same-night done state, even after a worked shift', () => {
  const done = doneState();
  // fromSleep omitted: every pre-BL-1640 (daemon) caller.
  const { state, actions } = tick(done, { workedAShift: true });
  assert.equal(state, done);
  assert.deepEqual(actions, []);
});

// ── BL-1640: bedtime never hangs - the sleep loop's own stop/wait decision ──

test('sleepLoopDecision: done always stops, regardless of the clock', () => {
  assert.equal(sleepLoopDecision('done', 0, 100), 'done');
  assert.equal(sleepLoopDecision('done', 1_000_000, 100), 'done');
});

test('sleepLoopDecision: waits while not done and the ceiling has not passed', () => {
  assert.equal(sleepLoopDecision('frozen', 100, 1_000), 'wait');
  assert.equal(sleepLoopDecision('briefing', 1_000 + SLEEP_CEILING_GRACE_MS - 1, 1_000), 'wait');
  assert.equal(sleepLoopDecision(undefined, 0, 1_000), 'wait');
});

test('sleepLoopDecision: overran once the ceiling (hardDeadline + grace) passes with no done', () => {
  assert.equal(sleepLoopDecision('frozen', 1_000 + SLEEP_CEILING_GRACE_MS, 1_000), 'overran');
  assert.equal(sleepLoopDecision('briefing', 1_000 + SLEEP_CEILING_GRACE_MS + 1, 1_000), 'overran');
  assert.equal(sleepLoopDecision(undefined, 1_000 + SLEEP_CEILING_GRACE_MS, 1_000), 'overran');
});
