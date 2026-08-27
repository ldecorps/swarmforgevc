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
// The pure decision core (queue-consuming?/front-desk-starving?/BL-345's
// classify-delivery-result/starvation-alarm-should-attempt?/next-
// starvation-alarm-state) is unit-tested directly in Babashka
// (operator_lib_test_runner.bb) - this layer proves the REAL wiring: a
// real llm-running? process, real events.jsonl, real status.json, and a
// real (test-fixture-suppressed, or BL-345's OPERATOR_ALARM_FORCE_RESULT
// seam - never actually sent) alarm-email attempt.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const RUNTIME_TICK_TEST = path.join(SWARMFORGE_SCRIPTS, 'test', 'test_operator_runtime_tick.sh');

// BL-345 front-desk-starvation-alarm-11: a Scenario Outline Examples column
// value MUST be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough - an unrecognized (e.g. mutated) value throws here
// rather than silently surviving (this project's own recurring gap, see
// restrictedFrontDeskOperatorSteps.js's KNOWN_SWARM_ACTIONS and the
// engineering article). Maps each known Examples value to the stable
// ctx.scenario tag the Then steps below branch on.
const MISCONFIG_KNOWN_VALUES = {
  'missing a recipient': '11-disabled',
  'missing its api key': '11-missing-api-key',
};

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
    } else if (ctx.scenario === '09') {
      expectLine(output, 'front-desk-starvation-alarm-09: an alarm that failed to deliver is retried, not treated as sent', '09');
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

  // ── front-desk-starvation-alarm-05 (AMENDED by BL-345: "raised" -> "delivered") ──
  registry.define(/^a starvation alarm has already been delivered for that starvation$/, (ctx) => {
    ctx.output = ctx.output || runRuntimeTickTest(ctx);
  });
  registry.define(/^the front desk's health is reported again$/, (ctx) => {
    ctx.output = ctx.output || runRuntimeTickTest(ctx);
  });
  registry.define(/^no further alarm is delivered$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    if (ctx.scenario === '10') {
      expectLine(output, 'front-desk-starvation-alarm-10: no further alarm is delivered once the cap is reached', '10');
    } else if (ctx.scenario === '11-disabled') {
      expectLine(output, 'front-desk-starvation-alarm-11 (missing a recipient): no further alarm is delivered', '11');
    } else if (ctx.scenario === '11-missing-api-key') {
      expectLine(output, 'front-desk-starvation-alarm-11 (missing its api key): no further alarm is delivered', '11');
    } else {
      expectLine(output, 'front-desk-starvation-alarm-05: still starving on the NEXT tick raises no further alarm', '05');
    }
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

  // ── BL-345 front-desk-starvation-alarm-09 ───────────────────────────
  // ("the front desk's health is reported" is already defined above, 01)
  registry.define(/^the previous alarm attempt failed to deliver$/, (ctx) => {
    ctx.scenario = '09';
    ctx.output = ctx.output || runRuntimeTickTest(ctx);
  });

  // ── BL-345 front-desk-starvation-alarm-10 ───────────────────────────
  registry.define(/^the delivery attempt limit has been reached$/, (ctx) => {
    ctx.scenario = '10';
    ctx.output = ctx.output || runRuntimeTickTest(ctx);
  });
  registry.define(/^the undelivered alarm is recorded loudly in the log$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, 'front-desk-starvation-alarm-10: the undelivered alarm is recorded loudly in the log', '10');
  });

  // ── BL-345 front-desk-starvation-alarm-11 (Scenario Outline) ────────
  registry.define(/^the alarm channel is (.+)$/, (ctx, misconfiguration) => {
    if (!Object.prototype.hasOwnProperty.call(MISCONFIG_KNOWN_VALUES, misconfiguration)) {
      throw new Error(`front-desk-starvation-alarm-11: unknown alarm-channel misconfiguration example value "${misconfiguration}"`);
    }
    ctx.scenario = MISCONFIG_KNOWN_VALUES[misconfiguration];
    ctx.output = ctx.output || runRuntimeTickTest(ctx);
  });
  registry.define(/^the misconfiguration is warned about exactly once$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    if (ctx.scenario === '11-missing-api-key') {
      expectLine(output, 'front-desk-starvation-alarm-11 (missing its api key): the misconfiguration is warned about exactly once', '11');
    } else if (ctx.scenario === '11-disabled') {
      expectLine(output, 'front-desk-starvation-alarm-11 (missing a recipient): the misconfiguration is warned about exactly once', '11');
    } else {
      throw new Error(`front-desk-starvation-alarm-11: unexpected scenario context "${ctx.scenario}"`);
    }
  });
}

module.exports = { registerSteps };
