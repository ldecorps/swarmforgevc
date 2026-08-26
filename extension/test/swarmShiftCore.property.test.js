'use strict';

// BL-660 declared invariant (coder first authorship — BL-654):
// "Every schedule-derived clock reads the single active shift definition —
// no start/stop/window/briefing constant exists outside it to drift."
//
// Generator reach: each draw picks one of the three named shifts and builds
// conf from that single line; every derived clock must match the canonical
// pack definition — collisions are constructed by derivation, not sampled.
//
// Non-vacuity (staged-first restore, 2026-08-26):
//   break — resolveShiftSchedule returns closureStopLocal hardcoded to 08:00:
//   RED on night shift (expects 09:00). Restored; ALL PROPERTIES HOLD.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { resolveShiftSchedule, formatLocalTime } = require('../out/tools/swarmShiftCore');
const { parseCooldownConfig } = require('../out/tools/cooldownWindowCore');
const { resolveClosureSchedule } = require('../out/quality/nightClosingCeremony');

const SHIFT_PACKS = {
  day: { start: '09:00', stop: '17:00' },
  evening: { start: '17:00', stop: '01:00' },
  night: { start: '01:00', stop: '09:00' },
};

const shiftArb = fc.constantFrom('day', 'evening', 'night');

function assertSameTime(actual, expectedHhmm, label) {
  assert.equal(formatLocalTime(actual), expectedHhmm, `${label} drift`);
}

test('BL-660/BL-654 invariant: every schedule-derived clock reads the single active shift', () => {
  fc.assert(
    fc.property(shiftArb, (shift) => {
      const conf = `config swarm_shift ${shift}\n`;
      const pack = SHIFT_PACKS[shift];
      const schedule = resolveShiftSchedule(conf);
      assert.ok(schedule, `expected schedule for ${shift}`);

      assertSameTime(schedule.startLocal, pack.start, 'start');
      assertSameTime(schedule.stopLocal, pack.stop, 'stop');
      assertSameTime(schedule.closureStopLocal, pack.stop, 'closure');
      assertSameTime(schedule.cooldownStartLocal, pack.stop, 'cooldown-start');
      assertSameTime(schedule.cooldownEndLocal, pack.start, 'cooldown-end');
      assert.equal(schedule.cooldownWindowEnabled, true);

      const cooldown = parseCooldownConfig(conf);
      assert.equal(cooldown.malformed, false);
      assert.equal(cooldown.config.enabled, true);
      assertSameTime(cooldown.config.startLocal, pack.stop, 'cooldown parse start');
      assertSameTime(cooldown.config.endLocal, pack.start, 'cooldown parse end');

      const closure = resolveClosureSchedule(conf);
      assert.equal(closure.state, 'ok');
      assertSameTime(closure.closure, pack.stop, 'closure resolver');
    }),
    { numRuns: 60 },
  );
});
