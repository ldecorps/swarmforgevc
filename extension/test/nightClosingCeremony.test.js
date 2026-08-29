'use strict';

const assert = require('node:assert/strict');
const {
  collectClosureStopLocals,
  resolveClosureSchedule,
  resolveCeremonyBegin,
  formatLocalTime,
  runClosingCeremony,
  defaultBudgets,
  shouldConsultFixedMorningTrigger,
  fixedMorningTriggerFires,
} = require('../out/quality/nightClosingCeremony');

function okFixture(overrides = {}) {
  return {
    schedule: { state: 'ok', closure: { hour: 6, minute: 0 }, surfaced: 'nothing' },
    budgets: defaultBudgets(),
    hardDeadline: { hour: 6, minute: 0 },
    inFlight: null,
    heldParcelIds: [],
    briefingAlreadySent: false,
    briefingNeverCommits: false,
    ...overrides,
  };
}

test('resolver: absent / ok / ambiguous from conf lines', () => {
  assert.equal(resolveClosureSchedule('').state, 'absent');
  assert.equal(resolveClosureSchedule('config briefing_morning_time_utc 04:30\n').state, 'absent');
  const ok = resolveClosureSchedule('config closure_stop_local 06:00\n');
  assert.equal(ok.state, 'ok');
  assert.deepEqual(ok.closure, { hour: 6, minute: 0 });
  const amb = resolveClosureSchedule(
    'config closure_stop_local 06:00\nconfig closure_stop_local 07:00\n'
  );
  assert.equal(amb.state, 'ambiguous');
  assert.equal(amb.surfaced, 'closure-schedule-ambiguous');
  const bad = resolveClosureSchedule('config closure_stop_local not-a-time\n');
  assert.equal(bad.state, 'ambiguous');
});

test('ceremony begin = closure − (drain + briefing)', () => {
  const budgets = defaultBudgets();
  assert.equal(formatLocalTime(resolveCeremonyBegin({ hour: 6, minute: 0 }, budgets)), '05:25');
  assert.equal(formatLocalTime(resolveCeremonyBegin({ hour: 7, minute: 0 }, budgets)), '06:25');
  assert.equal(formatLocalTime(resolveCeremonyBegin({ hour: 1, minute: 0 }, budgets)), '00:25');
});

test('nominal night: drain coder, rotate, briefing, send, stop', () => {
  const r = runClosingCeremony(
    okFixture({ inFlight: { role: 'coder', drainOutcome: 'completes' } })
  );
  assert.deepEqual(r.sequence, [
    'freeze-promotion',
    'parcel-drained',
    'rotate-documenter',
    'briefing-committed',
    'send-confirmed',
    'swarm-stopped',
  ]);
  assert.equal(r.rotationRequested, true);
  assert.equal(r.deliveriesAfterFreeze, 0);
  assert.equal(r.sendSource, 'sent-state');
  assert.equal(r.fixedMorningTriggerConsulted, false);
});

test('happy-days: documenter drain chains without rotation', () => {
  const r = runClosingCeremony(
    okFixture({ inFlight: { role: 'documenter', drainOutcome: 'completes' } })
  );
  assert.deepEqual(r.sequence, [
    'freeze-promotion',
    'parcel-drained',
    'briefing-committed',
    'send-confirmed',
    'swarm-stopped',
  ]);
  assert.equal(r.rotationRequested, false);
});

test('drain overrun parks claim and still ends on time', () => {
  const r = runClosingCeremony(
    okFixture({ inFlight: { role: 'coder', drainOutcome: 'running' } })
  );
  assert.ok(r.sequence.includes('parcel-parked'));
  assert.equal(r.parkedClaimIntact, true);
  assert.ok(r.loudSurfaces.includes('closing-drain-deadline-exceeded'));
  assert.equal(r.swarmStoppedAtOrBeforeHardDeadline, true);
});

test('missing briefing surfaces loudly; no send', () => {
  const r = runClosingCeremony(okFixture({ briefingNeverCommits: true }));
  assert.deepEqual(r.sequence, [
    'freeze-promotion',
    'rotate-documenter',
    'briefing-missing',
    'swarm-stopped',
  ]);
  assert.ok(r.loudSurfaces.includes('closing-briefing-missing'));
  assert.equal(r.sendConfirmations, 0);
});

test('already-sent night never double-sends or rotates', () => {
  const r = runClosingCeremony(okFixture({ briefingAlreadySent: true }));
  assert.deepEqual(r.sequence, [
    'freeze-promotion',
    'briefing-already-sent',
    'swarm-stopped',
  ]);
  assert.equal(r.rotationRequested, false);
  assert.equal(r.sendConfirmations, 1);
  // Send confirmation must come from .sent.json state, never file-exists (BL-658).
  assert.equal(r.sendSource, 'sent-state');
});

test('held parcels recorded in could-not-process window', () => {
  const r = runClosingCeremony(
    okFixture({
      inFlight: { role: 'coder', drainOutcome: 'completes' },
      heldParcelIds: ['held-1'],
    })
  );
  assert.ok(r.couldNotProcess);
  assert.equal(r.couldNotProcess.spanningCeremony, true);
  assert.deepEqual(r.couldNotProcess.heldParcelIds, ['held-1']);
});

test('unusable schedule keeps fixed-time trigger; no ceremony', () => {
  for (const schedule of [
    { state: 'absent', surfaced: 'nothing' },
    { state: 'ambiguous', surfaced: 'closure-schedule-ambiguous' },
  ]) {
    const r = runClosingCeremony(okFixture({ schedule }));
    assert.deepEqual(r.sequence, []);
    assert.equal(shouldConsultFixedMorningTrigger(schedule), true);
    assert.equal(fixedMorningTriggerFires(schedule), true);
    assert.equal(r.fixedMorningTriggerFired, true);
    if (schedule.state === 'ambiguous') {
      assert.deepEqual(r.loudSurfaces, ['closure-schedule-ambiguous']);
    }
  }
});

test('collectClosureStopLocals finds every config line', () => {
  assert.deepEqual(
    collectClosureStopLocals('config closure_stop_local 06:00\n# x\nconfig closure_stop_local 07:00\n'),
    ['06:00', '07:00']
  );
});
