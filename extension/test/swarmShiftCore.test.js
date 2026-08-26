'use strict';

const assert = require('node:assert/strict');
const {
  resolveShiftSchedule,
  longestStoppedGapMinutes,
  effectiveCloseLocal,
  extendedCloseAnnouncementText,
  formatLocalTime,
  parseSwarmShift,
} = require('../out/tools/swarmShiftCore');
const { parseCooldownConfig } = require('../out/tools/cooldownWindowCore');

test('BL-660 night shift derives all clocks from one conf line', () => {
  const conf = 'config swarm_shift night\n';
  const s = resolveShiftSchedule(conf);
  assert.equal(s.startLocal.hour, 1);
  assert.equal(s.stopLocal.hour, 9);
  assert.equal(s.closureStopLocal.hour, 9);
  const cooldown = parseCooldownConfig(conf);
  assert.equal(cooldown.config?.enabled, true);
  assert.equal(cooldown.config?.startLocal.hour, 9);
  assert.equal(cooldown.config?.endLocal.hour, 1);
});

test('BL-660 absent swarm_shift leaves cooldown disabled baseline', () => {
  const conf = 'config cooldown_window_enabled false\n';
  assert.equal(parseSwarmShift(conf), null);
  const cooldown = parseCooldownConfig(conf);
  assert.equal(cooldown.config?.enabled, false);
});

test('BL-660 stopped gap under 24h for every shift', () => {
  for (const shift of ['day', 'evening', 'night']) {
    assert.ok(longestStoppedGapMinutes(shift) < 24 * 60);
  }
});

test('BL-660 outage credit capped; swarm crash never credits', () => {
  const credited = effectiveCloseLocal({
    scheduledStopLocal: { hour: 9, minute: 0 },
    outageMinutes: 90,
    capMinutes: 120,
  });
  assert.equal(credited.hour, 10);
  assert.equal(credited.minute, 30);
  const noCredit = effectiveCloseLocal({
    scheduledStopLocal: { hour: 9, minute: 0 },
    outageMinutes: 90,
    swarmCaused: true,
  });
  assert.equal(noCredit.hour, 9);
});

test('BL-660 extended close announcement names credited interval', () => {
  const text = extendedCloseAnnouncementText({
    shift: 'night',
    outageMinutes: 90,
    scheduledStopLocal: { hour: 9, minute: 0 },
    effectiveCloseLocal: { hour: 10, minute: 30 },
  });
  assert.match(text, /90/);
  assert.match(text, /10:30/);
});
