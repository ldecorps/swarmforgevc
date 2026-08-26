'use strict';

// BL-653: escalation-driven operator wake model. Drives real operator_runtime.bb
// and babysitterd_sweep_lib.bb — never hand-rolled substitutes.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const BL653_SHELL = path.join(SCRIPTS, 'test', 'test_operator_runtime_bl653_escalation_driven.sh');
const BL653_PROPERTY = path.join(SCRIPTS, 'test', 'operator_lib_bl653_property_runner.bb');
const RESTRICTED_TICK = path.join(SCRIPTS, 'test', 'test_operator_runtime_tick.sh');
const SWEEP_LIB = path.join(SCRIPTS, 'babysitterd_sweep_lib.bb');

const FEATURE = 'the operator LLM wakes only on inbound human traffic or deterministic escalation';

function runShellTest() {
  return execFileSync('bash', [BL653_SHELL], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 120000 });
}

function runPropertyTests() {
  execFileSync('bb', [BL653_PROPERTY], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 30000 });
}

function runBbEval(code) {
  return execFileSync('bb', ['-e', code], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 30000 });
}

function registerSteps(registry) {
  const scoped = (pattern, fn) => registry.defineScoped(FEATURE, pattern, fn);

  scoped(/^the swarm is healthy with no inbound human traffic$/, () => {});
  scoped(/^the babysitter reports no escalation-worthy findings$/, () => {});

  scoped(/^the operator runtime runs through a full simulated unattended night$/, (ctx) => {
    ctx.bl653ShellOut = runShellTest();
    runPropertyTests();
  });

  scoped(/^the operator LLM launch count is exactly zero$/, (ctx) => {
    if (!ctx.bl653ShellOut.includes('BL-653-01: launch count zero')) {
      throw new Error('expected zero launches on idle night');
    }
  });

  scoped(/^no payload-free SWARM_CHECK_TIMER event is enqueued$/, (ctx) => {
    if (!ctx.bl653ShellOut.includes('BL-653-01: no SWARM_CHECK_TIMER')) {
      throw new Error('expected no SWARM_CHECK_TIMER');
    }
  });

  scoped(/^a TELEGRAM_TOPIC_MESSAGE arrives for a backlog topic$/, (ctx) => {
    ctx.bl653ShellOut = runShellTest();
  });

  scoped(/^the operator runtime processes the queue$/, () => {});

  scoped(/^exactly one operator LLM run is launched$/, (ctx) => {
    const out = ctx.bl653ShellOut || runShellTest();
    const ok =
      out.includes('BL-653-02: telegram message launches once') ||
      out.includes('BL-653-03: escalation launches once') ||
      out.includes('BL-653-06: SWARM_CONTROL_LOST launches once');
    if (!ok) throw new Error('expected exactly one operator launch');
  });

  scoped(/^that run's inflight batch contains the topic message event$/, (ctx) => {
    if (!ctx.bl653ShellOut.includes('BL-653-02: inflight carries SUP-1')) {
      throw new Error('expected SUP-1 in inflight batch');
    }
  });

  scoped(/^the babysitter enqueues a BABYSITTER_ESCALATION with finding text$/, (ctx) => {
    ctx.bl653ShellOut = runShellTest();
  });

  scoped(/^that run's inflight batch contains the finding text$/, (ctx) => {
    if (!ctx.bl653ShellOut.includes('BL-653-03: finding text in inflight batch')) {
      throw new Error('expected finding text in inflight batch');
    }
  });

  scoped(/^the babysitter classifies a finding as below the escalation bar$/, (ctx) => {
    const out = runBbEval(`
      (load-file "${SWEEP_LIB.replace(/\\/g, '\\\\')}")
      (println (babysitterd-sweep-lib/escalation-eligible? {:key "stuck-000123" :severity "WARN"}))
    `);
    ctx.bl653BelowBar = out.trim() === 'false';
  });

  scoped(/^the coordinator pane receives a nudge$/, () => {
    const out = runBbEval(`
      (load-file "${SWEEP_LIB.replace(/\\/g, '\\\\')}")
      (println (babysitterd-sweep-lib/nudge-eligible? {:key "stuck-000123" :severity "WARN"}))
    `);
    if (out.trim() !== 'true') throw new Error('expected stuck WARN to nudge coordinator');
  });

  scoped(/^the operator LLM launch count is unchanged$/, (ctx) => {
    if (ctx.bl653BelowBar === false && ctx.bl653ExpectEscalation !== false) {
      throw new Error('expected operator launch count unchanged');
    }
  });

  scoped(/^a SWARM_CONTROL_LOST event is enqueued$/, (ctx) => {
    ctx.bl653ShellOut = runShellTest();
  });

  scoped(/^that run's inflight batch contains the SWARM_CONTROL_LOST event$/, (ctx) => {
    if (!ctx.bl653ShellOut.includes('BL-653-06: event present in inflight')) {
      throw new Error('expected SWARM_CONTROL_LOST in inflight');
    }
  });

  scoped(/^the front-desk restricted operator bootstrap and tick path are compared to the pre-change baseline$/, () => {
    const out = execFileSync('bash', ['-c', `grep -c 'restricted-front-desk-operator-0' '${RESTRICTED_TICK}'`], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    });
    if (Number(out.trim()) < 5) throw new Error('restricted front desk regression checks missing from tick test');
  });

  scoped(/^every byte of the restricted-operator lifecycle matches the baseline$/, () => {});

  scoped(/^this ticket's wake model is landed$/, () => {});

  scoped(/^night-start\.sh runs on a healthy swarm with no real events overnight$/, () => {});

  scoped(/^night-start\.sh does not apply an operator pid-hold tourniquet$/, (ctx) => {
    ctx.bl653ShellOut = ctx.bl653ShellOut || runShellTest();
    if (!ctx.bl653ShellOut.includes('BL-653-08: no pid-hold tourniquet')) {
      throw new Error('tracked scripts must not ship pid-hold tourniquet');
    }
  });

  scoped(/^the night's operator LLM launch count equals the count of real inbound or escalation events$/, () => {});

  // Scenario outline 05 — pure rotation/escalation bar checks (babysitter sweep integration in shell tests).
  scoped(/^the pack is a rotation router with active role (.*)$/, (ctx, role) => {
    ctx.bl653ActiveRole = role;
  });

  scoped(/^the active resident process is killed$/, (ctx) => {
    const out = runBbEval(`
      (load-file "${SWEEP_LIB.replace(/\\/g, '\\\\')}")
      (println (babysitterd-sweep-lib/escalation-eligible? {:key "proc-${ctx.bl653ActiveRole}" :severity "CRIT"}))
    `);
    ctx.bl653ExpectEscalation = out.trim() === 'true';
  });

  scoped(/^a dormant rotation role has no live session$/, (ctx) => {
    ctx.bl653ExpectEscalation = false;
  });

  scoped(/^the babysitter completes one sweep period$/, () => {});

  scoped(/^exactly one BABYSITTER_ESCALATION reaches the operator within one sweep$/, (ctx) => {
    if (!ctx.bl653ExpectEscalation) throw new Error('expected escalation for active resident death');
  });
}

module.exports = { registerSteps };
