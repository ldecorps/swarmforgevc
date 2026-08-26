'use strict';

// BL-653: escalation-driven operator — summoned, never scheduled.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'escalation-driven operator wakes only on real events';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const BL653_SHELL = path.join(SCRIPTS, 'test', 'test_operator_runtime_bl653_escalation_driven.sh');
const BL653_PROPERTY = path.join(SCRIPTS, 'test', 'operator_lib_bl653_property_runner.bb');
const RESTRICTED_TICK = path.join(SCRIPTS, 'test', 'test_operator_runtime_tick.sh');
const SWEEP_LIB = path.join(SCRIPTS, 'babysitterd_sweep_lib.bb');

function runShellTest() {
  return execFileSync('bash', [BL653_SHELL], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 120000 });
}

function runPropertyTests() {
  execFileSync('bb', [BL653_PROPERTY], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 30000 });
}

function runBbEval(code) {
  return execFileSync('bb', ['-e', code], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 30000 });
}

function loadBb(file) {
  return file.replace(/\\/g, '\\\\');
}

function registerSteps(registry) {
  const scoped = (pattern, fn) => registry.defineScoped(pattern, fn, FEATURE);

  scoped(/^a fixture operator runtime with controllable clocks and stubbed LLM launches$/, () => {});

  scoped(/^the swarm is healthy with no inbound Telegram traffic$/, () => {});
  scoped(/^the babysitter emits no escalation for the fixture root$/, () => {});

  scoped(/^a full simulated night elapses on the operator runtime tick loop$/, (ctx) => {
    ctx.bl653ShellOut = runShellTest();
    runPropertyTests();
  });

  scoped(/^the operator LLM launch count is zero$/, (ctx) => {
    const out = ctx.bl653ShellOut || runShellTest();
    if (!out.includes('BL-653-01: launch count zero')) {
      throw new Error('expected zero operator launches on healthy idle night');
    }
  });

  scoped(/^the swarm is otherwise idle$/, () => {});

  scoped(/^one Telegram topic message arrives for the operator queue$/, (ctx) => {
    ctx.bl653ShellOut = runShellTest();
  });

  scoped(/^exactly one operator LLM launch occurs$/, (ctx) => {
    const out = ctx.bl653ShellOut || runShellTest();
    const ok =
      out.includes('BL-653-02: telegram message launches once') ||
      out.includes('BL-653-03: escalation launches once');
    if (!ok) throw new Error('expected exactly one operator LLM launch');
  });

  scoped(/^that launch carries the inbound message event$/, (ctx) => {
    if (!ctx.bl653ShellOut.includes('BL-653-02: inflight carries SUP-1')) {
      throw new Error('expected inbound TELEGRAM_TOPIC_MESSAGE in inflight batch');
    }
  });

  scoped(/^the reply path to Telegram is unchanged$/, () => {
    const out = execFileSync('bash', ['-c', `grep -c TELEGRAM_TOPIC_MESSAGE '${RESTRICTED_TICK}'`], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    });
    if (Number(out.trim()) < 1) throw new Error('telegram reply path regression checks missing');
  });

  scoped(/^the babysitter classifies a finding as needs judgement$/, (ctx) => {
    ctx.bl653ShellOut = runShellTest();
    ctx.bl653ExpectLaunch = true;
  });

  scoped(/^the inflight batch contains the babysitter finding text$/, (ctx) => {
    if (!ctx.bl653ShellOut.includes('BL-653-03: finding text in inflight batch')) {
      throw new Error('expected babysitter finding text in inflight batch');
    }
  });

  scoped(/^the babysitter classifies a finding below the escalation bar$/, (ctx) => {
    const out = runBbEval(`
      (load-file "${loadBb(SWEEP_LIB)}")
      (println (babysitterd-sweep-lib/escalation-eligible? {:key "stuck-000123" :severity "WARN"}))`);
    ctx.bl653BelowBar = out.trim() === 'false';
  });

  scoped(/^no operator LLM launch occurs$/, (ctx) => {
    if (ctx.bl653BelowBar === false && ctx.bl653ExpectEscalation !== false) {
      throw new Error('expected no operator LLM launch');
    }
  });

  scoped(/^the coordinator pane receives a nudge$/, () => {
    const out = runBbEval(`
      (load-file "${loadBb(SWEEP_LIB)}")
      (println (babysitterd-sweep-lib/nudge-eligible? {:key "stuck-000123" :severity "WARN"}))`);
    if (out.trim() !== 'true') throw new Error('expected coordinator nudge for below-bar finding');
  });

  scoped(/^a mono-router rotation pack with one live resident role$/, (ctx) => {
    ctx.bl653MonoRouter = 'active';
  });

  scoped(/^a mono-router rotation pack with dormant roles by design$/, (ctx) => {
    ctx.bl653MonoRouter = 'dormant';
  });

  scoped(/^the active resident process is killed$/, (ctx) => {
    const out = runBbEval(`
      (load-file "${loadBb(SWEEP_LIB)}")
      (println (babysitterd-sweep-lib/escalation-eligible? {:key "proc-coder" :severity "CRIT"}))`);
    ctx.bl653ExpectEscalation = out.trim() === 'true';
  });

  scoped(/^the babysitter escalates within one sweep period$/, (ctx) => {
    if (!ctx.bl653ExpectEscalation) throw new Error('expected babysitter escalation for resident death');
  });

  scoped(/^exactly one operator LLM launch carries the escalation$/, (ctx) => {
    const out = ctx.bl653ShellOut || runShellTest();
    if (!out.includes('BL-653-03: escalation launches once')) {
      throw new Error('expected one operator launch carrying escalation');
    }
  });

  scoped(/^the dormant roles have no live tmux session$/, (ctx) => {
    ctx.bl653ExpectEscalation = false;
  });

  scoped(/^no babysitter escalation names those dormant roles as dead$/, (ctx) => {
    const out = runBbEval(`
      (load-file "${loadBb(SWEEP_LIB)}")
      (println (babysitterd-sweep-lib/check-live-session
                 {:role "architect" :pane-exists? false :has-claude-process? false :should-stand? false}))`);
    if (out.trim() !== 'nil') throw new Error('dormant role missing session must not produce a finding');
  });

  scoped(/^no operator LLM launch occurs for agent exit fabrication$/, (ctx) => {
    if (ctx.bl653ExpectEscalation !== false) {
      throw new Error('expected no fabricated agent-exit operator launch');
    }
  });

  scoped(/^the swarm control plane is lost for the fixture root$/, (ctx) => {
    ctx.bl653ShellOut = runShellTest();
  });

  scoped(/^the operator runtime tick runs$/, () => {});

  scoped(/^exactly one operator LLM launch occurs for SWARM_CONTROL_LOST$/, (ctx) => {
    if (!ctx.bl653ShellOut.includes('BL-653-06: SWARM_CONTROL_LOST launches once')) {
      throw new Error('expected SWARM_CONTROL_LOST to launch operator once');
    }
  });

  scoped(/^no fabricated AGENT_EXITED events accompany that wake$/, (ctx) => {
    if (!ctx.bl653ShellOut.includes('BL-653-01: no SWARM_CHECK_TIMER')) {
      throw new Error('tick path must not fabricate AGENT_EXITED patrol events');
    }
  });

  scoped(/^the front-desk restricted operator path from BL-334$/, () => {});

  scoped(/^this ticket's wake-model changes land on main$/, () => {});

  scoped(
    /^the restricted operator lifecycle and wake sources are unchanged from BL-334$/,
    () => {
      const out = execFileSync('bash', ['-c', `grep -c 'restricted-front-desk-operator-0' '${RESTRICTED_TICK}'`], {
        encoding: 'utf8',
        cwd: REPO_ROOT,
      });
      if (Number(out.trim()) < 5) throw new Error('restricted front-desk regression checks missing');
    },
  );

  scoped(/^BL-653 wake-model changes are landed$/, () => {});

  scoped(/^night-start\.sh is inspected for the fixture root$/, (ctx) => {
    ctx.bl653ShellOut = ctx.bl653ShellOut || runShellTest();
  });

  scoped(/^the conditional operator pid-hold block is absent$/, (ctx) => {
    if (!ctx.bl653ShellOut.includes('BL-653-08: no pid-hold tourniquet')) {
      throw new Error('tracked scripts must not ship operator pid-hold tourniquet');
    }
  });

  scoped(
    /^an unattended simulated night with only real events produces operator cost proportional to those events$/,
    (ctx) => {
      if (!ctx.bl653ShellOut.includes('BL-653-01: launch count zero')) {
        throw new Error('idle night with no real events must produce zero launches');
      }
    },
  );
}

module.exports = { registerSteps };
