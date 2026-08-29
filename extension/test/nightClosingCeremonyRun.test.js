'use strict';

const assert = require('node:assert/strict');
const { runNightClosingCeremony } = require('../out/tools/night-closing-ceremony-run');

function makeDeps(over = {}) {
  const state = { current: null };
  const actions = [];
  return {
    deps: {
      readConf: () => 'config closure_stop_local 06:00\n',
      evaluate: () => ({
        mode: 'ceremony',
        scheduleState: 'ok',
        surfaced: 'nothing',
        consultFixedMorningTrigger: false,
        ceremonyDue: true,
        ceremonyBeginLocal: '05:25',
        closureStopLocal: '06:00',
      }),
      readState: () => state.current,
      writeState: (_t, s) => {
        state.current = s;
      },
      scanInFlight: () => ({ count: 0, roles: [] }),
      scanHeld: () => [],
      readActiveRole: () => 'coder',
      briefingSent: () => false,
      applyFreeze: (_t, untilMs) => actions.push(['freeze', untilMs]),
      rotateDocumenter: () => actions.push(['rotate']),
      instructBriefing: (_t, day) => actions.push(['instruct', day]),
      nightStop: () => actions.push(['stop']),
      surface: (_t, code) => actions.push(['surface', code]),
      recordCnp: (_t, held) => actions.push(['cnp', held]),
      ...over,
    },
    state,
    actions,
  };
}

test('live run freezes and instructs when due with empty in_process', () => {
  const { deps, actions, state } = makeDeps();
  // now local 05:30-ish is not needed — evaluate stub forces ceremonyDue.
  const result = runNightClosingCeremony('/tmp/bl658-fixture', '/tmp/conf', Date.now(), deps);
  assert.equal(result.gateMode, 'ceremony');
  assert.ok(actions.some((a) => a[0] === 'freeze'));
  // first tick freezes; second advances drain→briefing
  const result2 = runNightClosingCeremony('/tmp/bl658-fixture', '/tmp/conf', Date.now() + 1000, deps);
  assert.ok(actions.some((a) => a[0] === 'rotate'));
  assert.ok(actions.some((a) => a[0] === 'instruct'));
  assert.equal(state.current.phase, 'briefing');
  assert.ok(result2.state.sequence.includes('freeze-promotion'));
});

test('live run night-stops once briefing is marked sent', () => {
  const { deps, actions, state } = makeDeps();
  runNightClosingCeremony('/tmp/x', '/tmp/c', 1_000_000, deps);
  runNightClosingCeremony('/tmp/x', '/tmp/c', 1_001_000, deps);
  deps.briefingSent = () => true;
  runNightClosingCeremony('/tmp/x', '/tmp/c', 1_002_000, deps);
  assert.ok(actions.some((a) => a[0] === 'stop'));
  assert.equal(state.current.phase, 'done');
  assert.ok(state.current.sequence.includes('send-confirmed'));
});
