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
      // BL-1393: the lean pass is a step of this sequence now.
      deliverLeanPacket: (_t, shiftKey) => actions.push(['lean', shiftKey]),
      recordEmptyOutcome: (_t, shiftKey) => actions.push(['empty', shiftKey]),
      workedAShift: () => true,
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

// ── BL-1393 ──────────────────────────────────────────────────────────────

test('BL-1393: the ceremony delivers the lean packet before it instructs the briefing', () => {
  const { deps, actions } = makeDeps();
  runNightClosingCeremony('/tmp/bl1393', '/tmp/conf', Date.now(), deps);
  runNightClosingCeremony('/tmp/bl1393', '/tmp/conf', Date.now() + 1000, deps);

  const kinds = actions.map((a) => a[0]);
  assert.ok(kinds.includes('lean'), `no lean packet delivered: ${kinds.join(', ')}`);
  assert.ok(
    kinds.indexOf('lean') < kinds.indexOf('instruct'),
    `the packet must precede the briefing: ${kinds.join(', ')}`,
  );
});

test('BL-1393: a sleep path runs the ceremony even when the gate window is off', () => {
  // A weekday 17:00 bedtime: the gate says "off", the caller says "this is a
  // sleep". Before this ticket that combination ran the lean pass alone and
  // the full ceremony never happened on a weekday at all.
  const { deps, actions } = makeDeps({
    evaluate: () => ({ mode: 'off', scheduleState: 'ok', surfaced: 'nothing', ceremonyDue: false }),
  });

  const gated = runNightClosingCeremony('/tmp/bl1393', '/tmp/conf', Date.now(), deps);
  assert.equal(gated.advanced, false, 'with no sleep path the window still gates the daemon');
  assert.deepEqual(actions, []);

  const slept = runNightClosingCeremony('/tmp/bl1393', '/tmp/conf', Date.now(), deps, false, 'finish-shift');
  assert.equal(slept.gateMode, 'sleep:finish-shift');
  assert.ok(actions.some((a) => a[0] === 'freeze'), 'the sleep path freezes promotion');
});

test('BL-1393: a sleep after no shift of work records an empty outcome and sends no briefing', () => {
  const { deps, actions } = makeDeps({ workedAShift: () => false });
  runNightClosingCeremony('/tmp/bl1393', '/tmp/conf', Date.now(), deps, false, 'finish-shift');

  const kinds = actions.map((a) => a[0]);
  assert.ok(kinds.includes('empty'), `no empty outcome recorded: ${kinds.join(', ')}`);
  assert.ok(kinds.includes('stop'), 'the swarm still goes to sleep');
  assert.ok(!kinds.includes('instruct'), 'no briefing is instructed');
  assert.ok(!kinds.includes('lean'), 'no packet is delivered');
});
