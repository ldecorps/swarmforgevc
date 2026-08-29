'use strict';

const assert = require('node:assert/strict');
const { evaluateGate } = require('../out/tools/night-closing-ceremony-gate');

test('gate: usable closure schedule suppresses fixed morning', () => {
  const g = evaluateGate('config closure_stop_local 06:00\n', Date.UTC(2026, 7, 26, 12, 0, 0));
  assert.equal(g.mode, 'ceremony');
  assert.equal(g.consultFixedMorningTrigger, false);
  assert.equal(g.ceremonyBeginLocal, '05:25');
});

test('gate: absent schedule keeps fixed morning', () => {
  const g = evaluateGate('config briefing_morning_time_utc 04:30\n', Date.now());
  assert.equal(g.mode, 'fixed-time');
  assert.equal(g.consultFixedMorningTrigger, true);
  assert.equal(g.scheduleState, 'absent');
});

test('gate: ambiguous schedule keeps fixed morning and surfaces', () => {
  const g = evaluateGate(
    'config closure_stop_local 06:00\nconfig closure_stop_local 07:00\n',
    Date.now()
  );
  assert.equal(g.mode, 'fixed-time');
  assert.equal(g.consultFixedMorningTrigger, true);
  assert.equal(g.surfaced, 'closure-schedule-ambiguous');
});
