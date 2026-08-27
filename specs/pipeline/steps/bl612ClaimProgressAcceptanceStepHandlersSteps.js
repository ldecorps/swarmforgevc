'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE =
  'a claim without progress is auto-healed, and real work is never mistaken for idleness';
const REPO = path.join(__dirname, '..', '..', '..');
const CLAIM_LIB = path.join(REPO, 'swarmforge', 'scripts', 'claim_progress_lib.bb');
const CHASE_LIB = path.join(REPO, 'swarmforge', 'scripts', 'chase_sweep_lib.bb');

const KNOWN_EVIDENCE = new Set([
  'uncommitted work in worktree',
  'agent busy generating',
  'resident recently active',
]);
const KNOWN_ACTION = new Set(['nudges', 'bounces', 'halts on']);
const KNOWN_STATE = new Set([
  'the resident agent is working',
  "a dormant role's claim is stale",
]);
const KNOWN_ROLE = new Set(['coder', 'hardender']);
const KNOWN_AGE = new Set(['30 min', '2 h']);
const KNOWN_VERDICT = new Set(['overdue', 'not yet overdue']);

function runBb(expr) {
  const r = spawnSync('bb', ['-e', expr], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout.trim();
}

function ensure(ctx) {
  if (!ctx.bl612) {
    ctx.bl612 = {
      role: 'coder',
      claimCommit: 'aaaa000000',
      head: 'aaaa000000',
      claimAtMs: 0,
      nowMs: 0,
      reclaims: 0,
      probed: false,
      idleProbeAtMs: null,
      probeGraceMs: 600000,
      worktreeDirty: false,
      agentBusy: false,
      residentBusy: false,
      residentRecentlyActive: false,
      rotationRouter: false,
      activeRole: 'coder',
      lastSignal: null,
      lastClassify: null,
      halted: false,
      refuseHalt: false,
      telegram: '',
      emailSubject: '',
      sidecarCleared: false,
      postRelaunchHalt: false,
      thresholds: { nudge: 1, bounce: 6, halt: 10 },
      mode: 'signal',
    };
  }
  return ctx.bl612;
}

function progressEdn(st) {
  const probe =
    st.probed && st.idleProbeAtMs != null ? ` :idleProbeAtMs ${st.idleProbeAtMs}` : '';
  return `{:claimCommit "${st.claimCommit}" :claimAtMs ${st.claimAtMs} :reclaims ${st.reclaims}${probe}}`;
}

function configEdn(st) {
  const t = st.thresholds;
  return `{:nudge-threshold ${t.nudge} :bounce-threshold ${t.bounce} :halt-threshold ${t.halt} :probe-grace-ms ${st.probeGraceMs}}`;
}

function evalSignal(st) {
  return runBb(`
(load-file "${CLAIM_LIB}")
(def progress ${progressEdn(st)})
(def cfg ${configEdn(st)})
(println (name (claim-progress-lib/evaluate-claim-idle-signal
  progress "${st.head}" ${st.nowMs} cfg
  {:role "${st.role}"
   :agent-busy? ${st.agentBusy}
   :worktree-dirty? ${st.worktreeDirty}
   :resident-busy? ${st.residentBusy}
   :resident-recently-active? ${st.residentRecentlyActive}
   :active-role "${st.activeRole}"
   :rotation-router? ${st.rotationRouter}})))
`);
}

function classify(st) {
  return runBb(`
(load-file "${CLAIM_LIB}")
(def progress ${progressEdn(st)})
(println (name (claim-progress-lib/classify-claim-progress
  progress "${st.head}" ${st.nowMs} {} :role "${st.role}")))
`);
}

function decide(reclaims, st) {
  return runBb(`
(load-file "${CLAIM_LIB}")
(println (name (claim-progress-lib/decide-claim-idle-action
  ${reclaims} ${configEdn(st)})))
`);
}

function runSweep(ctx) {
  const st = ensure(ctx);
  if (st.mode === 'halt-refuse') {
    st.refuseHalt =
      runBb(`
(load-file "${CLAIM_LIB}")
(println (claim-progress-lib/should-refuse-claim-halt?
  {:role "${st.role}"
   :resident-busy? ${st.residentBusy}
   :resident-recently-active? ${st.residentRecentlyActive}
   :active-role "${st.activeRole}"
   :rotation-router? ${st.rotationRouter}}))
`) === 'true';
    st.halted = !st.refuseHalt;
    st.telemetryRefuse = st.refuseHalt;
    return;
  }
  if (st.mode === 'classify-only') {
    st.lastClassify = classify(st);
    st.lastSignal = st.lastClassify;
    return;
  }
  st.lastSignal = evalSignal(st);
  st.lastClassify = classify(st);
  if (st.lastSignal === 'claimed-idle') {
    const next = st.reclaims + 1;
    st.lastAction = decide(next, st);
    st.reclaims = next;
    if (st.lastAction === 'halt') {
      st.halted = true;
    }
  } else if (st.lastSignal === 'probe-agent') {
    st.probed = true;
    st.idleProbeAtMs = st.nowMs;
  }
}

function performHalt(ctx) {
  const st = ensure(ctx);
  st.halted = true;
  st.telegram = runBb(
    `(load-file "${CLAIM_LIB}") (print (claim-progress-lib/format-telegram-alert "${st.role}" ${st.reclaims}))`
  );
  st.emailSubject = runBb(
    `(load-file "${CLAIM_LIB}") (print (claim-progress-lib/format-email-subject "${st.role}"))`
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl612-claim-'));
  const handoff = path.join(dir, 'idle.handoff');
  const sidecar = `${handoff}.claim-progress.json`;
  fs.writeFileSync(handoff, 'id: idle\n');
  fs.writeFileSync(sidecar, JSON.stringify({ claimCommit: 'aaaa000000', claimAtMs: 0, reclaims: 10 }));
  runBb(`
(load-file "${CHASE_LIB}")
(chase-sweep-lib/clear-claim-progress! "${handoff}")
`);
  st.sidecarCleared = !fs.existsSync(sidecar);
  // First sweep after relaunch: reclaims start at 0 → probe, not halt.
  st.reclaims = 0;
  st.probed = false;
  st.idleProbeAtMs = null;
  st.probeGraceMs = 600000;
  st.postRelaunchSignal = evalSignal(st);
  st.postRelaunchHalt = st.postRelaunchSignal === 'claimed-idle' && decide(1, st) === 'halt';
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a role holding a claimed task in its in_process mailbox$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^the role's worktree HEAD has advanced past the commit it claimed at$/, (ctx) => {
    const st = ensure(ctx);
    st.claimCommit = 'aaaa000000';
    st.head = 'bbbb111111';
    st.claimAtMs = 0;
    st.nowMs = 60_000;
    st.mode = 'signal';
  });

  scoped(/^the claim-progress sweep runs$/, (ctx) => {
    runSweep(ctx);
  });

  scoped(/^the claim is treated as "progressing"$/, (ctx) => {
    assert.equal(ensure(ctx).lastSignal, 'progressed');
  });

  scoped(/^no idle reclaim is counted against the role$/, (ctx) => {
    assert.notEqual(ensure(ctx).lastSignal, 'claimed-idle');
  });

  scoped(/^the claim is past its idle timeout with no new commit$/, (ctx) => {
    const st = ensure(ctx);
    st.claimCommit = 'aaaa000000';
    st.head = 'aaaa000000';
    st.claimAtMs = 0;
    st.nowMs = 25 * 60 * 1000;
    st.mode = 'signal';
  });

  scoped(/^the role shows activity as "(.+)"$/, (ctx, evidence) => {
    assert.ok(KNOWN_EVIDENCE.has(evidence), `unknown evidence: ${evidence}`);
    const st = ensure(ctx);
    const flags = {
      'uncommitted work in worktree': { worktreeDirty: true },
      'agent busy generating': { agentBusy: true },
      'resident recently active': { residentRecentlyActive: true },
    }[evidence];
    Object.assign(st, { worktreeDirty: false, agentBusy: false, residentRecentlyActive: false }, flags);
  });

  scoped(/^the swarm is not halted$/, (ctx) => {
    assert.equal(ensure(ctx).halted, false);
  });

  scoped(/^nothing indicates the role is working$/, (ctx) => {
    const st = ensure(ctx);
    st.worktreeDirty = false;
    st.agentBusy = false;
    st.residentBusy = false;
    st.residentRecentlyActive = false;
  });

  scoped(/^the role has not been probed about this claim$/, (ctx) => {
    const st = ensure(ctx);
    st.probed = false;
    st.idleProbeAtMs = null;
    st.reclaims = 0;
  });

  scoped(/^the role is probed once about its idle claim$/, (ctx) => {
    assert.equal(ensure(ctx).lastSignal, 'probe-agent');
    assert.equal(ensure(ctx).probed, true);
  });

  scoped(/^a further sweep within the probe grace period still counts no idle reclaim$/, (ctx) => {
    const st = ensure(ctx);
    st.nowMs = st.idleProbeAtMs + 60_000;
    st.lastSignal = evalSignal(st);
    assert.equal(st.lastSignal, 'not-yet-overdue');
  });

  scoped(/^the escalation thresholds are nudge 1, bounce 6, and halt 10$/, (ctx) => {
    ensure(ctx).thresholds = { nudge: 1, bounce: 6, halt: 10 };
  });

  scoped(/^the role has been probed about this claim$/, (ctx) => {
    const st = ensure(ctx);
    st.probed = true;
    st.idleProbeAtMs = 0;
    st.probeGraceMs = 0;
  });

  scoped(/^the idle reclaim count for this claim has reached (.+)$/, (ctx, n) => {
    ensure(ctx).reclaims = Number(n);
  });

  scoped(/^the daemon "(.+)" the idle claim$/, (ctx, action) => {
    assert.ok(KNOWN_ACTION.has(action), `unknown action: ${action}`);
    const st = ensure(ctx);
    const decided = decide(st.reclaims, st);
    const map = { nudges: 'nudge', bounces: 'bounce', 'halts on': 'halt' };
    assert.equal(decided, map[action]);
  });

  scoped(/^the idle reclaim count has reached the halt threshold$/, (ctx) => {
    const st = ensure(ctx);
    st.reclaims = 10;
    st.probed = true;
    st.idleProbeAtMs = 0;
    st.probeGraceMs = 0;
    st.claimCommit = 'aaaa000000';
    st.head = 'aaaa000000';
    st.claimAtMs = 0;
    st.nowMs = 25 * 60 * 1000;
  });

  scoped(/^the daemon halts the swarm for the idle claim$/, (ctx) => {
    performHalt(ctx);
  });

  scoped(/^the operator is alerted by Telegram naming the role and reclaim count$/, (ctx) => {
    const st = ensure(ctx);
    assert.match(st.telegram, new RegExp(st.role));
    assert.match(st.telegram, /reclaims=/);
  });

  scoped(/^the operator is emailed about the same halt$/, (ctx) => {
    const st = ensure(ctx);
    assert.match(st.emailSubject, /claim-without-progress halt/);
    assert.match(st.emailSubject, new RegExp(st.role));
  });

  scoped(/^the claim-progress record for that claim is cleared$/, (ctx) => {
    assert.equal(ensure(ctx).sidecarCleared, true);
  });

  scoped(/^the first sweep after a relaunch does not halt the swarm again$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.postRelaunchHalt, false);
    assert.notEqual(st.postRelaunchSignal, 'claimed-idle');
  });

  scoped(/^the swarm state is "(.+)"$/, (ctx, state) => {
    assert.ok(KNOWN_STATE.has(state), `unknown state: ${state}`);
    const st = ensure(ctx);
    st.mode = 'halt-refuse';
    if (state === 'the resident agent is working') {
      st.residentBusy = true;
      st.rotationRouter = false;
    } else {
      st.residentBusy = false;
      st.rotationRouter = true;
      st.role = 'coder';
      st.activeRole = 'cleaner';
    }
  });

  scoped(/^the refusal is recorded as telemetry$/, (ctx) => {
    assert.equal(ensure(ctx).telemetryRefuse, true);
  });

  scoped(/^the claim is "(.+)" old with no new commit and no evidence of activity$/, (ctx, age) => {
    assert.ok(KNOWN_AGE.has(age), `unknown age: ${age}`);
    const st = ensure(ctx);
    st.mode = 'classify-only';
    st.claimCommit = 'aaaa000000';
    st.head = 'aaaa000000';
    st.claimAtMs = 0;
    st.worktreeDirty = false;
    st.agentBusy = false;
    st.nowMs = age === '30 min' ? 30 * 60 * 1000 : 2 * 60 * 60 * 1000;
  });

  scoped(/^the role is "(.+)"$/, (ctx, role) => {
    assert.ok(KNOWN_ROLE.has(role), `unknown role: ${role}`);
    ensure(ctx).role = role;
  });

  scoped(/^the claim is treated as "(.+)"$/, (ctx, verdict) => {
    assert.ok(KNOWN_VERDICT.has(verdict), `unknown verdict: ${verdict}`);
    const st = ensure(ctx);
    const want = verdict === 'overdue' ? 'claimed-idle' : 'not-yet-overdue';
    assert.equal(st.lastClassify, want);
  });
}

module.exports = { registerSteps };
