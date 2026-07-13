'use strict';

// BL-333: step handlers for "A starved front desk is loud, not silent".
// Drives the REAL shell integration suite
// (test_operator_runtime_tick.sh, real disposable background processes
// standing in for an attended Operator holding the slot, real
// operator_runtime.bb --tick-once invocations, real starvation-state
// persistence) as a subprocess and greps its own precisely-named PASS
// lines - mirrors supervisorReaperPathBoundarySteps.js's/
// mergedCodeReachesDaemonsSteps.js's own "drive the real shell test, grep
// the PASS line" pattern rather than re-implementing the fixture here.
// The pure decision core (queue-consuming?/front-desk-starving?/
// starvation-alarm-decision) is unit-tested directly in Babashka
// (operator_lib_test_runner.bb) - this layer proves the REAL wiring: a
// real llm-running? process, real events.jsonl, real status.json, and a
// real (test-fixture-suppressed, never actually sent) alarm-email attempt.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const RUNTIME_TICK_TEST = path.join(SWARMFORGE_SCRIPTS, 'test', 'test_operator_runtime_tick.sh');

function runRuntimeTickTest(ctx) {
  if (ctx.starvationTestOutput) {
    return ctx.starvationTestOutput;
  }
  const result = spawnSync('bash', [RUNTIME_TICK_TEST], { encoding: 'utf8', timeout: 120000 });
  ctx.starvationTestOutput = (result.stdout || '') + (result.stderr || '');
  return ctx.starvationTestOutput;
}

function expectLine(output, fragment, label) {
  if (!output.includes(fragment)) {
    throw new Error(`expected "${fragment}" (${label}) in the real operator_runtime tick test output, got:\n${output}`);
  }
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^an Operator holds the slot that the front desk's reader would need$/, () => {
    // Narrative only - the real shell test's own hold_operator_slot spawns
    // a REAL disposable background process and writes its pid to
    // operator.pid, exactly what an attended Operator session does
    // (operator-running? cannot distinguish it from a disposable one).
  });

  // ── front-desk-starvation-alarm-01 ──────────────────────────────────
  registry.define(/^the front desk's inbound queue is not being consumed$/, (ctx) => {
    ctx.output = runRuntimeTickTest(ctx);
  });
  registry.define(/^the front desk's health is reported$/, (ctx) => {
    ctx.output = ctx.output || runRuntimeTickTest(ctx);
  });
  registry.define(/^an Operator is reported as running$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, 'front-desk-starvation-alarm-01: an Operator is reported as running', '01');
  });
  registry.define(/^the queue is reported as not being consumed$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, 'front-desk-starvation-alarm-01: the queue is reported as not being consumed', '01');
  });
  registry.define(/^those are reported as two distinct facts$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, 'front-desk-starvation-alarm-01: pending_events reflects the real backlog', '01');
  });

  // ── front-desk-starvation-alarm-02 ──────────────────────────────────
  registry.define(/^more inbound messages are waiting than the configured limit allows$/, (ctx) => {
    ctx.output = ctx.output || runRuntimeTickTest(ctx);
  });
  registry.define(/^a starvation alarm is raised$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    if (ctx.scenario === '06') {
      expectLine(output, 'front-desk-starvation-alarm-06: a starvation that clears and returns is alarmed again', '06');
    } else {
      expectLine(output, 'front-desk-starvation-alarm-02: a queue over the count limit raises a starvation alarm', '02');
    }
  });

  // ── front-desk-starvation-alarm-03 ──────────────────────────────────
  registry.define(/^a single inbound message has been waiting longer than the configured limit$/, (ctx) => {
    ctx.output = ctx.output || runRuntimeTickTest(ctx);
  });
  registry.define(/^fewer messages are waiting than the count limit allows$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, 'front-desk-starvation-alarm-03: fewer messages than the count limit', '03');
  });

  // ── front-desk-starvation-alarm-04 ──────────────────────────────────
  registry.define(/^the alarm is delivered on the operator alarm channel$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, "front-desk-starvation-alarm-04: the alarm reuses daemon_alarm_lib's own email path", '04');
  });
  registry.define(/^the alarm is not delivered through the front desk$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, 'front-desk-starvation-alarm-04: the runtime never load-files a Telegram client', '04');
  });

  // ── front-desk-starvation-alarm-05 ──────────────────────────────────
  registry.define(/^a starvation alarm has already been raised for that starvation$/, (ctx) => {
    ctx.output = ctx.output || runRuntimeTickTest(ctx);
  });
  registry.define(/^the front desk's health is reported again$/, (ctx) => {
    ctx.output = ctx.output || runRuntimeTickTest(ctx);
  });
  registry.define(/^no further alarm is delivered$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, 'front-desk-starvation-alarm-05: still starving on the NEXT tick raises no further alarm', '05');
  });

  // ── front-desk-starvation-alarm-06 ──────────────────────────────────
  registry.define(/^the waiting messages have since been consumed$/, (ctx) => {
    ctx.scenario = '06';
    ctx.output = ctx.output || runRuntimeTickTest(ctx);
  });

  // ── front-desk-starvation-alarm-07 ──────────────────────────────────
  registry.define(/^the front desk's inbound queue is being consumed$/, (ctx) => {
    ctx.output = ctx.output || runRuntimeTickTest(ctx);
  });
  registry.define(/^no starvation alarm is raised$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, 'front-desk-starvation-alarm-07: no Operator holding the slot, no alarm', '07');
  });

  // ── front-desk-starvation-alarm-08 ──────────────────────────────────
  registry.define(/^the Operator holding the slot is still running$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, 'front-desk-starvation-alarm-08: the Operator holding the slot is still running', '08');
    expectLine(output, 'ALL CHECKS PASSED', 'full suite');
  });
}

module.exports = { registerSteps };
