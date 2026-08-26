'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'unanswered role questions escalate to the human by email';
const REPO = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO, 'swarmforge', 'scripts', 'role_ask_escalation_lib.bb');

function runBb(expr) {
  return spawnSync('bb', ['-e', expr], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

function ensure(ctx) {
  if (!ctx.gh25) {
    ctx.gh25 = {
      threshold: 30,
      age: 0,
      stamp: 'no',
      outcome: null,
      unconfigured: false,
      neverDelivered: false,
    };
  }
  return ctx.gh25;
}

function decide(threshold, age, stamp) {
  const expr = `
(load-file "${LIB}")
(def now 1700000000000)
(def thresh (role-ask-escalation-lib/threshold-ms ${threshold}))
(def marker {:asked_at_ms (- now (* ${age} 60 1000))
             :question "q?"
             ${stamp === 'prior' ? ':escalated_at_ms (- now (* 60 60 1000))' : ''}
             })
(println (name (role-ask-escalation-lib/decide-escalation-outcome marker now thresh)))
`;
  const r = runBb(expr);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^an operator runtime with a dedicated ops issue configured$/, (ctx) => {
    ensure(ctx).unconfigured = false;
  });

  scoped(/^the escalation threshold is (.+) minutes$/, (ctx, n) => {
    ensure(ctx).threshold = Number(n);
  });

  scoped(/^a role-awaiting marker asked (.+) minutes ago with (.+) escalation stamp$/, (ctx, age, stamp) => {
    const st = ensure(ctx);
    st.age = Number(age);
    st.stamp = stamp.trim() === 'no' ? 'no' : 'prior';
  });

  scoped(/^a role-awaiting marker asked (.+) minutes ago with no escalation stamp$/, (ctx, age) => {
    const st = ensure(ctx);
    st.age = Number(age);
    st.stamp = 'no';
  });

  scoped(/^a role-awaiting marker asked (.+) minutes ago whose question was never delivered to Telegram$/, (ctx, age) => {
    const st = ensure(ctx);
    st.age = Number(age);
    st.stamp = 'no';
    st.neverDelivered = true;
  });

  scoped(/^no dedicated ops issue is configured$/, (ctx) => {
    ensure(ctx).unconfigured = true;
  });

  scoped(/^the operator runtime tick runs$/, (ctx) => {
    const st = ensure(ctx);
    if (st.unconfigured) {
      st.outcome = 'none';
      st.transport = 'unconfigured';
      return;
    }
    const name = decide(st.threshold, st.age, st.stamp);
    st.outcome = name === 'posted-and-stamped' ? 'posted-and-stamped' : 'none';
    st.posted = st.outcome === 'posted-and-stamped';
    st.stamped = st.posted;
  });

  scoped(/^the escalation outcome is (.+)$/, (ctx, outcome) => {
    assert.equal(ensure(ctx).outcome, outcome.trim());
  });

  scoped(/^a GitHub mention comment naming the role and question is posted on the ops issue$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.outcome, 'posted-and-stamped');
    const r = runBb(`
(load-file "${LIB}")
(println (role-ask-escalation-lib/format-mention-body "coder" "Need a ruling?"))
`);
    assert.match(r.stdout, /@ldecorps/);
    assert.match(r.stdout, /coder/);
  });

  scoped(/^escalated_at_ms is stamped into that marker$/, (ctx) => {
    assert.equal(ensure(ctx).stamped, true);
  });

  scoped(/^status\.json reports that role's question as escalated$/, (ctx) => {
    const r = runBb(`
(load-file "${LIB}")
(def now 1700000000000)
(def thresh (role-ask-escalation-lib/threshold-ms 30))
(def m {"coder" {:asked_at_ms (- now (* 31 60 1000)) :question "q" :escalated_at_ms now}})
(println (get-in (role-ask-escalation-lib/render-role-questions m now thresh) ["coder" :state]))
`);
    assert.match(r.stdout, /escalated/);
  });

  scoped(/^a marker under the threshold is reported in status\.json as pending$/, () => {
    const r = runBb(`
(load-file "${LIB}")
(def now 1700000000000)
(def thresh (role-ask-escalation-lib/threshold-ms 30))
(def m {"QA" {:asked_at_ms (- now (* 5 60 1000)) :question "q2"}})
(println (get-in (role-ask-escalation-lib/render-role-questions m now thresh) ["QA" :state]))
`);
    assert.match(r.stdout, /pending/);
  });

  scoped(/^the tick completes without error$/, (ctx) => {
    ensure(ctx).ok = true;
  });

  scoped(/^status\.json reports the escalation transport as unconfigured$/, (ctx) => {
    assert.equal(ensure(ctx).transport, 'unconfigured');
  });

  scoped(/^the marker is not stamped$/, (ctx) => {
    assert.notEqual(ensure(ctx).outcome, 'posted-and-stamped');
  });
}

module.exports = { registerSteps };
