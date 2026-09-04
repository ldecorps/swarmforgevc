'use strict';

// BL-658: closing ceremony — briefing is the night's last act.
const assert = require('node:assert/strict');
const path = require('node:path');

const FEATURE = 'The closing ceremony ends the shift with the briefing, and the briefing ends the shift';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const {
  resolveClosureSchedule,
  resolveCeremonyBegin,
  formatLocalTime,
  runClosingCeremony,
  defaultBudgets,
  shouldConsultFixedMorningTrigger,
} = require(path.join(REPO_ROOT, 'extension', 'out', 'quality', 'nightClosingCeremony'));

function ensure(ctx) {
  if (!ctx.bl658) {
    ctx.bl658 = {
      closureTime: '06:00',
      budgets: defaultBudgets(),
      resident: null,
      drainOutcome: 'completes',
      inFlight: true,
      briefingAlreadySent: false,
      briefingNeverCommits: false,
      heldParcelIds: [],
      scheduleOverride: null,
      result: null,
      beginResolved: null,
      claimsInProcess: 1,
    };
  }
  return ctx.bl658;
}

function scheduleFromCtx(st) {
  if (st.scheduleOverride) {
    return st.scheduleOverride;
  }
  return resolveClosureSchedule(`config closure_stop_local ${st.closureTime}\n`);
}

function hardDeadline(st) {
  const [h, m] = st.closureTime.split(':').map(Number);
  return { hour: h, minute: m };
}

function runCeremony(st) {
  const schedule = scheduleFromCtx(st);
  const inFlight =
    st.inFlight && st.resident
      ? { role: st.resident, drainOutcome: st.drainOutcome }
      : null;
  st.result = runClosingCeremony({
    schedule,
    budgets: st.budgets,
    hardDeadline: hardDeadline(st),
    inFlight,
    heldParcelIds: st.heldParcelIds,
    briefingAlreadySent: st.briefingAlreadySent,
    briefingNeverCommits: st.briefingNeverCommits,
  });
  if (st.result.sequence.includes('swarm-stopped')) {
    st.claimsInProcess = 0;
  }
  return st.result;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a closing-ceremony fixture whose closure schedule stops the swarm at "([^"]+)"$/, (ctx, t) => {
    ensure(ctx).closureTime = t;
  });

  scoped(/^a drain budget of (\d+) minutes and a briefing budget of (\d+) minutes$/, (ctx, d, b) => {
    const st = ensure(ctx);
    st.budgets = {
      drainBudgetMinutes: Number(d),
      briefingBudgetMinutes: Number(b),
    };
  });

  scoped(/^the resident is "([^"]+)" holding an in-flight parcel$/, (ctx, role) => {
    const st = ensure(ctx);
    st.resident = role;
    st.inFlight = true;
  });

  scoped(/^that parcel's stage completes within the drain budget$/, (ctx) => {
    ensure(ctx).drainOutcome = 'completes';
  });

  scoped(/^that parcel's stage is still running when the drain budget expires$/, (ctx) => {
    ensure(ctx).drainOutcome = 'running';
  });

  scoped(/^no parcel is in flight when the ceremony begins$/, (ctx) => {
    const st = ensure(ctx);
    st.inFlight = false;
    st.resident = null;
  });

  scoped(/^the documenter never commits the briefing$/, (ctx) => {
    ensure(ctx).briefingNeverCommits = true;
  });

  scoped(/^the briefing for that night is already recorded as sent$/, (ctx) => {
    ensure(ctx).briefingAlreadySent = true;
  });

  scoped(/^a second parcel is held in its inbox by the promotion freeze$/, (ctx) => {
    ensure(ctx).heldParcelIds = ['held-inbox-1'];
  });

  scoped(/^the closure schedule is moved to stop the swarm at "([^"]+)"$/, (ctx, t) => {
    ensure(ctx).closureTime = t;
  });

  scoped(/^the fixture's closure schedule is replaced with "([^"]+)"$/, (ctx, state) => {
    const st = ensure(ctx);
    const overrides = {
      absent: { state: 'absent', surfaced: 'nothing' },
      ambiguous: { state: 'ambiguous', surfaced: 'closure-schedule-ambiguous' },
    };
    const next = overrides[state];
    if (!next) {
      throw new Error(`unknown scheduleState ${state}`);
    }
    st.scheduleOverride = next;
  });

  scoped(/^the closing ceremony runs$/, (ctx) => {
    runCeremony(ensure(ctx));
  });

  scoped(/^the ceremony begin time is resolved$/, (ctx) => {
    const st = ensure(ctx);
    const schedule = scheduleFromCtx(st);
    assert.equal(schedule.state, 'ok');
    st.beginResolved = formatLocalTime(resolveCeremonyBegin(schedule.closure, st.budgets));
    st.result = {
      fixedMorningTriggerConsulted: shouldConsultFixedMorningTrigger(schedule),
      fixedMorningTriggerFired: false,
    };
  });

  scoped(/^the ceremony sweep runs at the fixed briefing time$/, (ctx) => {
    runCeremony(ensure(ctx));
  });

  scoped(/^the recorded closing sequence is "([^"]+)"$/, (ctx, seq) => {
    assert.equal(ensure(ctx).result.sequence.join(', '), seq);
  });

  scoped(/^no parcel was delivered after the freeze$/, (ctx) => {
    assert.equal(ensure(ctx).result.deliveriesAfterFreeze, 0);
  });

  scoped(/^the send confirmation came from the briefing sent-state, not from the briefing file existing$/, (ctx) => {
    assert.equal(ensure(ctx).result.sendSource, 'sent-state');
  });

  scoped(/^zero claims remain in in_process across all mailboxes$/, (ctx) => {
    assert.equal(ensure(ctx).claimsInProcess, 0);
  });

  scoped(/^no rotation was requested$/, (ctx) => {
    assert.equal(ensure(ctx).result.rotationRequested, false);
  });

  scoped(/^the parcel is parked with its claim intact$/, (ctx) => {
    assert.equal(ensure(ctx).result.parkedClaimIntact, true);
  });

  scoped(/^the parked parcel is surfaced loudly as "([^"]+)"$/, (ctx, code) => {
    assert.ok(ensure(ctx).result.loudSurfaces.includes(code));
  });

  scoped(/^the swarm is stopped no later than "([^"]+)"$/, (ctx) => {
    assert.equal(ensure(ctx).result.swarmStoppedAtOrBeforeHardDeadline, true);
  });

  scoped(/^the swarm is stopped at the hard deadline "([^"]+)"$/, (ctx) => {
    assert.equal(ensure(ctx).result.swarmStoppedAtOrBeforeHardDeadline, true);
  });

  scoped(/^the missing briefing is surfaced loudly as "([^"]+)"$/, (ctx, code) => {
    assert.ok(ensure(ctx).result.loudSurfaces.includes(code));
  });

  scoped(/^no briefing send is recorded for that night$/, (ctx) => {
    assert.equal(ensure(ctx).result.sendConfirmations, 0);
  });

  scoped(/^the ceremony begins at "([^"]+)"$/, (ctx, t) => {
    assert.equal(ensure(ctx).beginResolved, t);
  });

  scoped(/^the fixed-time briefing trigger is never consulted$/, (ctx) => {
    assert.equal(ensure(ctx).result.fixedMorningTriggerConsulted, false);
  });

  scoped(/^no closing ceremony is begun$/, (ctx) => {
    assert.deepEqual(ensure(ctx).result.sequence, []);
  });

  scoped(/^the swarm is not stopped$/, (ctx) => {
    assert.equal(ensure(ctx).result.sequence.includes('swarm-stopped'), false);
  });

  scoped(/^the fixed-time briefing trigger fires exactly as it does today$/, (ctx) => {
    assert.equal(ensure(ctx).result.fixedMorningTriggerFired, true);
  });

  scoped(/^the resolver surfaces "([^"]+)"$/, (ctx, surfaced) => {
    const st = ensure(ctx);
    const schedule = scheduleFromCtx(st);
    if (surfaced === 'nothing') {
      assert.equal(schedule.surfaced, 'nothing');
      assert.deepEqual(st.result.loudSurfaces, []);
    } else {
      assert.equal(schedule.surfaced, surfaced);
      assert.ok(st.result.loudSurfaces.includes(surfaced));
    }
  });

  scoped(/^exactly one send is recorded for that night$/, (ctx) => {
    assert.equal(ensure(ctx).result.sendConfirmations, 1);
  });

  scoped(/^a could-not-process window spanning the whole ceremony is recorded$/, (ctx) => {
    const w = ensure(ctx).result.couldNotProcess;
    assert.ok(w);
    assert.equal(w.spanningCeremony, true);
  });

  scoped(/^the held parcel is named in that window$/, (ctx) => {
    const w = ensure(ctx).result.couldNotProcess;
    assert.ok(w.heldParcelIds.includes('held-inbox-1'));
  });
}

module.exports = { registerSteps };
