'use strict';

// BL-334: step handlers for "The human is answered even while an Operator
// is busy". Drives the REAL shell integration suite
// (test_operator_runtime_tick.sh, real disposable background processes
// standing in for an attended Operator holding the slot, real
// operator_runtime.bb --tick-once invocations, a real DRYRUN launch-command
// assembly) as a subprocess and greps its own precisely-named PASS lines -
// the SAME "drive the real shell test, grep the PASS line" pattern as
// BL-333's own frontDeskStarvationAlarmSteps.js. The pure decision core
// (should-launch-front-desk-operator?/select-front-desk-dispatch-batch/
// front-desk-reply-text) is unit-tested directly in Babashka
// (operator_lib_test_runner.bb/telegram_topic_lib_test_runner.bb) - this
// layer proves the REAL wiring. The live proof that a REAL Opus call is
// structurally unable to act on the swarm is QA's own E2E gate per the
// ticket's own "E2E QA PROCEDURE" - not reproduced here.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const RUNTIME_TICK_TEST = path.join(SWARMFORGE_SCRIPTS, 'test', 'test_operator_runtime_tick.sh');

function runRuntimeTickTest(ctx) {
  if (ctx.fdOutput) {
    return ctx.fdOutput;
  }
  const result = spawnSync('bash', [RUNTIME_TICK_TEST], { encoding: 'utf8', timeout: 120000 });
  ctx.fdOutput = (result.stdout || '') + (result.stderr || '');
  return ctx.fdOutput;
}

function expectLine(output, fragment, label) {
  if (!output.includes(fragment)) {
    throw new Error(`expected "${fragment}" (${label}) in the real operator_runtime tick test output, got:\n${output}`);
  }
}

// The restriction is ONE structural mechanism (--tools "" removes every
// tool, regardless of which forbidden action is named), so every Examples
// row is proven by the SAME DRYRUN command-assembly checks - there is no
// per-action branch in the real wiring to prove separately.
const SWARM_ACTION_FRAGMENTS = [
  "restricted-front-desk-operator-03: the launch command has NO tool access (--tools '')",
  'restricted-front-desk-operator-03: --dangerously-skip-permissions is NEVER passed',
];

// Engineering-article Acceptance Pipeline rule: every Scenario Outline
// Examples column value is validated against an explicit KNOWN_VALUES
// lookup, never a bare passthrough - a mutated/misspelled example value must
// fail immediately here rather than silently surviving because the actual
// check downstream (SWARM_ACTION_FRAGMENTS) is deliberately the same for
// every row.
const KNOWN_SWARM_ACTIONS = new Set([
  'promote a backlog item',
  'respawn an agent',
  'merge to the main branch',
]);

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^an Operator is mid-conversation with the human and will not exit$/, () => {
    // Narrative only - the real shell test's own hold_operator_slot spawns a
    // REAL disposable background process and writes its pid to
    // operator.pid, exactly what an attended Operator session does
    // (operator-running? cannot distinguish it from a disposable one).
  });

  // ── restricted-front-desk-operator-01 ───────────────────────────────
  // BL-351 shares this EXACT step text ("the human sends a message to the
  // front desk") for its own front-desk-survives-reboot-03 - the registry
  // resolves first-match, so whichever module registers this regex first
  // speaks for every scenario that uses it (see
  // mergedCodeReachesDaemonsSteps.js's own identical note for "the swarm's
  // health is reported"). Dispatches to ctx.frontDeskInboundRunner when an
  // earlier Given step in the SAME scenario has set one; absent that flag
  // (every scenario this file itself owns), behavior is UNCHANGED.
  registry.define(/^the human sends a message to the front desk$/, async (ctx) => {
    if (ctx.frontDeskInboundRunner) {
      await ctx.frontDeskInboundRunner();
      return;
    }
    ctx.output = runRuntimeTickTest(ctx);
  });
  registry.define(/^the message is read$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, 'restricted-front-desk-operator-01: the front desk dispatches even while the full Operator holds the slot', '01');
  });
  registry.define(/^the human receives an answer$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, 'restricted-front-desk-operator-04: the reply reaches the SAME reply-outbox any Operator reply uses', '01/04');
  });

  // ── restricted-front-desk-operator-02 ───────────────────────────────
  registry.define(/^the Operator mid-conversation with the human is still running$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, 'restricted-front-desk-operator-02: the attended Operator holding the slot is not cut short', '02');
  });

  // ── restricted-front-desk-operator-03 (Scenario Outline) ─────────────
  // Also the shared "the front-desk Operator is running" precondition for
  // scenarios 04/06/07. Sets ctx.healthReportRunner so scenario 07's later
  // "the swarm's health is reported" step - text SHARED with
  // mergedCodeReachesDaemonsSteps.js's own merged-code-reaches-daemons-01 -
  // dispatches to THIS domain's test instead of that one's (see that
  // file's own dispatch comment).
  registry.define(/^the front-desk Operator is running$/, (ctx) => {
    ctx.healthReportRunner = runRuntimeTickTest;
    ctx.output = ctx.output || runRuntimeTickTest(ctx);
  });
  registry.define(/^it attempts to (.+)$/, (ctx, swarmAction) => {
    if (!KNOWN_SWARM_ACTIONS.has(swarmAction)) {
      throw new Error(`restricted-front-desk-operator-03: unknown swarm_action example value "${swarmAction}"`);
    }
    ctx.swarmAction = swarmAction;
  });
  registry.define(/^the action does not happen$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    SWARM_ACTION_FRAGMENTS.forEach((fragment) => expectLine(output, fragment, `03 (${ctx.swarmAction})`));
  });
  registry.define(/^the swarm's state is unchanged$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, "restricted-front-desk-operator-06: the unrestricted Operator's OWN inflight file is untouched", '03/06');
  });

  // ── restricted-front-desk-operator-04 ───────────────────────────────
  registry.define(/^it replies to the human$/, (ctx) => {
    ctx.output = ctx.output || runRuntimeTickTest(ctx);
  });
  registry.define(/^the reply reaches the human$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, "restricted-front-desk-operator-04: the reply is appended to the thread's own transcript too", '04');
  });

  // ── restricted-front-desk-operator-05 ───────────────────────────────
  registry.define(/^an unrestricted Operator is running$/, (ctx) => {
    ctx.output = ctx.output || runRuntimeTickTest(ctx);
  });
  registry.define(/^another unrestricted Operator is requested$/, () => {
    // Narrative only - should-launch-operator?'s own `(not llm-running?)`
    // gate is UNCHANGED by this ticket; "it is not started" below asserts
    // the full suite (which exercises that pre-existing gate directly)
    // still passes end to end.
  });
  registry.define(/^it is not started$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, 'operator_runtime smoke: ALL CHECKS PASSED', '05');
  });

  // ── restricted-front-desk-operator-06 ───────────────────────────────
  registry.define(/^both Operators are given the chance to process it$/, (ctx) => {
    ctx.output = ctx.output || runRuntimeTickTest(ctx);
  });
  registry.define(/^the message is processed exactly once$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, 'restricted-front-desk-operator-06 control: the front desk claims nothing in this case', '06');
  });

  // ── restricted-front-desk-operator-07 ───────────────────────────────
  registry.define(/^the swarm's health is reported$/, (ctx) => {
    ctx.output = ctx.output || runRuntimeTickTest(ctx);
  });
  registry.define(/^both Operators are reported$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, 'restricted-front-desk-operator-07: the front-desk Operator is ALSO reported, nested and distinct', '07');
  });
  registry.define(/^neither Operator's state has overwritten the other's$/, (ctx) => {
    const output = ctx.output || runRuntimeTickTest(ctx);
    expectLine(output, 'restricted-front-desk-operator-07: the full Operator is reported running', '07');
    expectLine(output, 'operator_runtime smoke: ALL CHECKS PASSED', 'full suite');
  });
}

module.exports = { registerSteps };
