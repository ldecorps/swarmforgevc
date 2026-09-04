'use strict';

// BL-1393 declared invariants (coder-authored per BL-654 / coder.prompt).
// Runs ONLY via `npm run test:properties`.
//
//   1. One ceremony sequence: every stop that is a sleep drives the same
//      ordered steps, and the lean pass is one of those steps, never a second
//      mechanism beside them.
//   2. The ceremony fires only after at least one shift of work since the last
//      ceremony and only on a stop that is a sleep: a restart never fires it,
//      a sleep after no work records an explicit empty outcome and sends no
//      briefing, and nothing here reschedules a shift.
//   3. Every ceremony ends in a recorded outcome: the packet reaches the
//      specifier's work loop or an explicit empty outcome is written, and the
//      briefing for a day-key is sent at most once.
//
// GENERATOR REACH is constructed, not hoped for. The state machine is driven
// to COMPLETION on every draw - a generator that only ever took the first tick
// would leave the lean step (which lives past the drain) astronomically rare,
// the failure shape the coder contract names. Each property asserts the states
// it needed were reached: `reach.completed`, `reach.worked`/`reach.idle`,
// `reach.packet`/`reach.empty`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  advanceNightClosingCeremony,
} = require('../out/quality/nightClosingCeremonyLive');

const HOUR = 3_600_000;

function observation(over = {}) {
  const nowMs = 1_757_000_000_000;
  return {
    nowMs,
    nightKey: '2026-09-04',
    dayKey: '2026-09-04',
    ceremonyDue: true,
    drainBudgetMs: 25 * 60_000,
    hardDeadlineMs: nowMs + HOUR,
    inFlightCount: 0,
    activeRole: 'coder',
    heldParcelIds: [],
    briefingAlreadySent: false,
    workedAShift: true,
    ...over,
  };
}

// Drive the sequence to completion the way a real caller does: tick until the
// phase stops changing or the ceremony is done. Returns every action in order.
//
// `drainsAfterTicks` is how the DRAIN branch is reached on purpose rather than
// by luck: a parcel that finishes while the budget still stands drains, and one
// that never finishes is parked at the deadline. Stepping the clock by half an
// hour on every tick - my first draft - passed the 25-minute budget before any
// parcel could finish, so `parcel-drained` was unreachable and 30/30 runs
// parked. The step is now five minutes, and the parcel clears when the draw
// says it does.
function runToCompletion(over = {}, ticks = 12, drainsAfterTicks = 1) {
  let state = null;
  const actions = [];
  let nowMs = observation(over).nowMs;
  const startingInFlight = observation(over).inFlightCount;
  // The briefing lands after it is instructed - the documenter writes the day
  // and the sender records it. Modelling that is what lets the ceremony REACH
  // `done`; without it every run sat in `briefing` until the hard deadline and
  // the completed state was never observed at all.
  let instructedAt = null;
  for (let i = 0; i < ticks; i++) {
    const inFlightCount = i >= drainsAfterTicks ? 0 : startingInFlight;
    const briefingLanded = instructedAt !== null && i > instructedAt;
    const obs = observation({
      ...over,
      nowMs,
      inFlightCount,
      briefingAlreadySent: over.briefingAlreadySent === true || briefingLanded,
    });
    const advance = advanceNightClosingCeremony(state, obs);
    state = advance.state;
    actions.push(...advance.actions);
    if (instructedAt === null && advance.actions.some((a) => a.kind === 'instruct-briefing')) {
      instructedAt = i;
    }
    if (state.phase === 'done') break;
    nowMs += 5 * 60_000;
  }
  return { state, actions, kinds: actions.map((a) => a.kind) };
}

describe('BL-1393 declared invariants', () => {
  it('inv1: every sleep drives one ordered sequence with the lean pass inside it', () => {
    const reach = { completed: 0, drained: 0, parked: 0 };

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.constantFrom('coder', 'documenter', 'cleaner', 'QA'),
        fc.array(fc.stringMatching(/^BL-[0-9]{3}$/), { maxLength: 3 }),
        // 1 = the parcel finishes inside the budget (drain); 99 = it never
        // does (park at the deadline). Both branches by construction.
        fc.constantFrom(1, 99),
        (inFlightCount, activeRole, heldParcelIds, drainsAfterTicks) => {
          const { state, kinds } = runToCompletion(
            { inFlightCount, activeRole, heldParcelIds },
            12,
            drainsAfterTicks,
          );

          if (state.phase === 'done') reach.completed += 1;
          if (state.sequence.includes('parcel-drained')) reach.drained += 1;
          if (state.sequence.includes('parcel-parked')) reach.parked += 1;

          // The lean pass is a STEP of this sequence, whatever the shape of
          // the night - not a second mechanism a different caller runs.
          assert.ok(
            state.sequence.includes('lean-packet'),
            `no lean step in: ${state.sequence.join(' -> ')}`,
          );
          // Order is the invariant, not merely presence: freeze first, the
          // packet after the parcel is dealt with, the briefing after that.
          assert.equal(state.sequence[0], 'freeze-promotion');
          const leanAt = state.sequence.indexOf('lean-packet');
          const settledAt = Math.max(
            state.sequence.indexOf('parcel-drained'),
            state.sequence.indexOf('parcel-parked'),
          );
          assert.ok(leanAt > settledAt, `the packet preceded the parcel's fate: ${state.sequence.join(' -> ')}`);
          const briefingAt = kinds.indexOf('instruct-briefing');
          if (briefingAt !== -1) {
            assert.ok(
              kinds.indexOf('lean-packet') < briefingAt,
              `the packet must precede the briefing: ${kinds.join(', ')}`,
            );
          }
        },
      ),
      { numRuns: 30 },
    );

    assert.ok(reach.completed > 0, `generator never completed a ceremony: ${JSON.stringify(reach)}`);
    assert.ok(reach.drained > 0, `generator never drained a parcel: ${JSON.stringify(reach)}`);
    assert.ok(reach.parked > 0, `generator never parked a parcel: ${JSON.stringify(reach)}`);
  }, 120000);

  it('inv2: no work means an explicit empty outcome, no briefing, and still a sleep', () => {
    const reach = { worked: 0, idle: 0 };

    fc.assert(
      fc.property(fc.boolean(), fc.integer({ min: 0, max: 2 }), (workedAShift, inFlightCount) => {
        const { state, kinds } = runToCompletion({ workedAShift, inFlightCount });
        reach[workedAShift ? 'worked' : 'idle'] += 1;

        if (workedAShift) {
          assert.ok(state.sequence.includes('lean-packet'));
          return;
        }
        // A sleep after no work: quiet, but never silent.
        assert.equal(state.phase, 'done');
        assert.ok(
          state.sequence.includes('no-shift-since-last-ceremony'),
          `the sequence must say why: ${state.sequence.join(' -> ')}`,
        );
        assert.ok(kinds.includes('record-empty-outcome'), 'the outcome must be recorded');
        assert.ok(kinds.includes('night-stop'), 'the swarm still sleeps');
        assert.ok(!kinds.includes('instruct-briefing'), 'no briefing for a shift that never happened');
        assert.ok(!kinds.includes('lean-packet'), 'no packet either');
      }),
      { numRuns: 30 },
    );

    assert.ok(reach.worked > 0 && reach.idle > 0, `both sides must be reached: ${JSON.stringify(reach)}`);
  }, 120000);

  it('inv3: every ceremony ends recorded, and a day-key is briefed at most once', () => {
    const reach = { packet: 0, empty: 0, alreadySent: 0 };

    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (workedAShift, briefingAlreadySent) => {
        const { state, kinds } = runToCompletion({ workedAShift, briefingAlreadySent });

        // Ends recorded: either the packet went to the specifier's loop or an
        // explicit empty outcome was written. Never neither.
        const recorded = kinds.includes('lean-packet') || kinds.includes('record-empty-outcome');
        assert.ok(recorded, `a ceremony ended with nothing recorded: ${state.sequence.join(' -> ')}`);
        if (kinds.includes('lean-packet')) reach.packet += 1;
        if (kinds.includes('record-empty-outcome')) reach.empty += 1;

        // At most once per day-key: a ceremony told the briefing is already
        // sent never instructs another.
        if (briefingAlreadySent) {
          reach.alreadySent += 1;
          assert.ok(
            !kinds.includes('instruct-briefing'),
            `a second briefing was instructed for the same day-key: ${kinds.join(', ')}`,
          );
        }
        assert.ok(
          kinds.filter((k) => k === 'instruct-briefing').length <= 1,
          `the briefing was instructed more than once: ${kinds.join(', ')}`,
        );
      }),
      { numRuns: 30 },
    );

    assert.ok(reach.packet > 0, `generator never delivered a packet: ${JSON.stringify(reach)}`);
    assert.ok(reach.empty > 0, `generator never took the empty path: ${JSON.stringify(reach)}`);
    assert.ok(reach.alreadySent > 0, `generator never met an already-sent briefing: ${JSON.stringify(reach)}`);
  }, 120000);
});
