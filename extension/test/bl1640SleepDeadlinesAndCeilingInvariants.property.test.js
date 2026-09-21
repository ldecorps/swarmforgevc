'use strict';

// BL-1640 declared invariants (coder-authored per BL-654 / coder.prompt).
// Runs ONLY via `npm run test:properties`.
//
//   1. On a sleep path, no stop-set component is stopped while the ceremony
//      state for this sleep is not done, unless the ceiling (drain plus
//      briefing budgets plus grace) has passed and the overrun was surfaced.
//      Encoded against `sleepLoopDecision`, the one pure decision
//      finish_shift_lib.sh's polling loop consults each tick: it must never
//      say "stop" while not done and the ceiling has not passed, and must
//      always say "overran" (never silently "wait") once the ceiling has
//      passed with no done. The shell loop's own control flow (never
//      stopping components before this decision leaves 'wait') is exercised
//      by test_finish_shift_lib.sh and the BL-1640 acceptance feature - a
//      process-ordering claim outside a pure module's reach.
//   2. Every deadline the sleep path writes (drainDeadlineMs, hardDeadlineMs,
//      the freeze's untilMs) is later than the sleep's own start time; a
//      sleep never inherits a deadline from a stop time that has already
//      passed. Encoded against `runNightClosingCeremony` with a sleep path,
//      driven through real gate budgets end to end.
//
// GENERATOR REACH is constructed, not hoped for: every draw for invariant 2
// starts a FRESH ceremony under a sleep path by construction (fresh target,
// no prior state, ceremonyDue forced true by the sleep path itself), so
// `startFrozen`'s sleep-relative deadline math is reached on every run, not
// merely possible. Invariant 1's three regions (wait / done / overran) are
// each driven by construction via `fc.constantFrom` over the phase and by
// deriving the boundary offset directly from the grace constant, rather than
// hoping a wide random draw lands exactly on the boundary.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  sleepLoopDecision,
  SLEEP_CEILING_GRACE_MS,
} = require('../out/quality/nightClosingCeremonyLive');
const { runNightClosingCeremony } = require('../out/tools/night-closing-ceremony-run');

function makeRunDeps(over = {}) {
  const state = { current: null };
  return {
    readConf: () => '',
    evaluate:
      over.evaluate ??
      (() => ({
        mode: 'ceremony',
        scheduleState: 'ok',
        surfaced: 'nothing',
        consultFixedMorningTrigger: false,
        ceremonyDue: false,
        ceremonyBeginLocal: '05:25',
        closureStopLocal: '08:45',
        drainBudgetMinutes: over.drainBudgetMinutes,
        briefingBudgetMinutes: over.briefingBudgetMinutes,
      })),
    readState: () => state.current,
    writeState: (_t, s) => {
      state.current = s;
    },
    scanInFlight: () => ({ count: 0, roles: [] }),
    scanHeld: () => [],
    readActiveRole: () => 'coder',
    briefingSent: () => false,
    applyFreeze: () => {},
    rotateDocumenter: () => {},
    instructBriefing: () => {},
    nightStop: () => {},
    surface: () => {},
    recordCnp: () => {},
    deliverLeanPacket: () => [],
    recordEmptyOutcome: () => [],
    workedAShift: () => true,
  };
}

describe('BL-1640 declared invariants', () => {
  it('inv1: sleepLoopDecision never says stop while not done and the ceiling has not passed', () => {
    const reach = { wait: 0, done: 0, overran: 0 };

    fc.assert(
      fc.property(
        fc.constantFrom('idle', 'frozen', 'briefing', 'done', undefined),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        // Offset from the ceiling boundary (hardDeadlineMs + grace), spanning
        // well before, exactly at, and well after it - the three regions by
        // construction, not by hoping a wide random draw lands there.
        fc.integer({ min: -SLEEP_CEILING_GRACE_MS - 1, max: SLEEP_CEILING_GRACE_MS + 1 }),
        (phase, hardDeadlineMs, ceilingOffsetMs) => {
          const nowMs = hardDeadlineMs + SLEEP_CEILING_GRACE_MS + ceilingOffsetMs;
          const decision = sleepLoopDecision(phase, nowMs, hardDeadlineMs);
          const ceilingPassed = nowMs >= hardDeadlineMs + SLEEP_CEILING_GRACE_MS;

          if (phase === 'done') {
            assert.equal(decision, 'done', 'a done phase must always stop as done, whatever the clock');
            reach.done += 1;
            return;
          }
          if (ceilingPassed) {
            assert.equal(
              decision,
              'overran',
              `the ceiling passed with no done - must say overran, got ${decision}`,
            );
            reach.overran += 1;
          } else {
            assert.equal(
              decision,
              'wait',
              `not done and the ceiling has not passed - must keep waiting, got ${decision}`,
            );
            reach.wait += 1;
          }
        },
      ),
      { numRuns: 200 },
    );

    assert.ok(reach.wait > 0, `generator never reached the wait region: ${JSON.stringify(reach)}`);
    assert.ok(reach.done > 0, `generator never reached the done region: ${JSON.stringify(reach)}`);
    assert.ok(reach.overran > 0, `generator never reached the overran region: ${JSON.stringify(reach)}`);
  });

  it('inv2: a sleep never inherits a deadline earlier than its own start time', () => {
    const reach = { started: 0 };

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        fc.integer({ min: 1, max: 240 }),
        fc.integer({ min: 1, max: 240 }),
        (nowMs, drainBudgetMinutes, briefingBudgetMinutes) => {
          const deps = makeRunDeps({ drainBudgetMinutes, briefingBudgetMinutes });
          const result = runNightClosingCeremony(
            '/tmp/bl1640-inv2',
            '/tmp/conf',
            nowMs,
            deps,
            false,
            'finish-shift',
          );
          reach.started += 1;

          assert.ok(
            result.state.drainDeadlineMs > nowMs,
            `drainDeadlineMs (${result.state.drainDeadlineMs}) must be later than the sleep's start (${nowMs})`,
          );
          assert.ok(
            result.state.hardDeadlineMs > nowMs,
            `hardDeadlineMs (${result.state.hardDeadlineMs}) must be later than the sleep's start (${nowMs})`,
          );
          const freeze = result.actions.find((a) => a.kind === 'freeze');
          assert.ok(freeze, 'a new ceremony must freeze promotion');
          assert.ok(
            freeze.untilMs > nowMs,
            `the freeze's untilMs (${freeze.untilMs}) must be later than the sleep's start (${nowMs})`,
          );
          assert.equal(freeze.untilMs, result.state.hardDeadlineMs, "the freeze lasts until the state's own hardDeadlineMs");
        },
      ),
      { numRuns: 200 },
    );

    assert.ok(reach.started > 0, 'generator never started a ceremony');
  });
});
