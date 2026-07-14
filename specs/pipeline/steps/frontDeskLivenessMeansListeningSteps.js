'use strict';

// BL-370: step handlers for "The front desk reports itself healthy while
// it has stopped listening - a live process is not proof it is
// consuming". Drives the REAL shell integration suite
// (test_front_desk_supervisor_liveness.sh, a real front_desk_supervisor.bb
// subprocess, a real fake bot process, a real poll-heartbeat JSON file,
// and BL-345's own real - if force-scripted - email-send path) and greps
// its own precisely-named PASS lines, mirroring
// frontDeskStarvationAlarmSteps.js's/mergedCodeReachesDaemonsSteps.js's
// own "drive the real shell test, grep the PASS line" pattern rather than
// re-implementing the fixture (with its real spawn/backoff timing) here a
// second time. The pure decision core (poll-heartbeat-stale?, check-one!
// extended with heartbeat-stale?) is unit-tested directly in Babashka
// (front_desk_supervisor_lib_test_runner.bb) - this layer proves the REAL
// wiring: a real heartbeat file read, a real bounded restart of a real
// process, and a real (force-scripted, never actually sent) escalation
// email attempt.
//
// "Then the failure is escalated to the human" (scenario 04) is IDENTICAL
// step text to BL-369's own no-inbound-message-is-ever-lost-05 scenario -
// reused, not re-registered (this codebase's own established convention
// for shared step text). See noInboundMessageIsEverLostSteps.js's own
// handler, extended there to branch on which ticket's ctx shape is
// present.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const LIVENESS_TEST = path.join(SWARMFORGE_SCRIPTS, 'test', 'test_front_desk_supervisor_liveness.sh');

function runLivenessTest(ctx) {
  if (ctx.output) {
    return ctx.output;
  }
  const result = spawnSync('bash', [LIVENESS_TEST], { encoding: 'utf8', timeout: 120000 });
  ctx.output = (result.stdout || '') + (result.stderr || '');
  return ctx.output;
}

function expectPass(output, label) {
  if (!output.includes(`ok   - ${label}`)) {
    throw new Error(`expected "ok   - ${label}" in the real front-desk-liveness test output, got:\n${output}`);
  }
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the front desk's process is alive$/, (ctx) => {
    // Narrative only - the real shell test's own make_fixture already
    // starts a real bridge+bot pair (attempt 1, running) before any
    // scenario-specific heartbeat is written.
    ctx.output = runLivenessTest(ctx);
  });

  // ── front-desk-liveness-means-listening-01 ──────────────────────────
  registry.define(/^it has not completed a poll of the chat service within its stall window$/, (ctx) => {
    ctx.output = ctx.output || runLivenessTest(ctx);
  });
  registry.define(/^the supervisor checks its health$/, (ctx) => {
    ctx.output = ctx.output || runLivenessTest(ctx);
  });
  registry.define(/^the front desk is reported as stalled$/, (ctx) => {
    expectPass(ctx.output || runLivenessTest(ctx), "front-desk-liveness-01: a stopped-listening bot is reported as stalled, never plain 'running'");
  });

  // ── front-desk-liveness-means-listening-02 ──────────────────────────
  registry.define(/^it is completing polls of the chat service$/, (ctx) => {
    ctx.output = ctx.output || runLivenessTest(ctx);
  });
  registry.define(/^no human has written to it$/, () => {
    // Narrative only - the mechanism never distinguishes "quiet" from
    // "busy", only whether a poll cycle completed (the ticket's own
    // load-bearing design point).
  });
  registry.define(/^the front desk is reported as healthy$/, (ctx) => {
    expectPass(ctx.output || runLivenessTest(ctx), 'front-desk-liveness-02: a quiet-but-polling front desk is reported healthy, never stalled');
  });

  // ── front-desk-liveness-means-listening-03 ──────────────────────────
  registry.define(/^the front desk is stalled$/, (ctx) => {
    ctx.output = ctx.output || runLivenessTest(ctx);
  });
  registry.define(/^the front desk is restarted$/, (ctx) => {
    expectPass(ctx.output || runLivenessTest(ctx), 'front-desk-liveness-03: a stalled front desk is restarted with no human action (attempts grows, running again)');
  });
  registry.define(/^it resumes listening$/, (ctx) => {
    expectPass(ctx.output || runLivenessTest(ctx), 'front-desk-liveness-03: it resumes listening (a fresh pid is spawned)');
  });

  // ── front-desk-liveness-means-listening-04 ──────────────────────────
  registry.define(/^the front desk stalls again after each restart$/, (ctx) => {
    ctx.output = ctx.output || runLivenessTest(ctx);
    // "the failure is escalated to the human" (the Then step below) is
    // reused from noInboundMessageIsEverLostSteps.js's own shared handler
    // - it checks ctx.logText for BL-370's ctx shape.
    ctx.logText = ctx.output;
  });
  registry.define(/^the supervisor has restarted it up to its limit$/, (ctx) => {
    ctx.output = ctx.output || runLivenessTest(ctx);
    ctx.logText = ctx.logText || ctx.output;
  });
  registry.define(/^it stops restarting the front desk$/, (ctx) => {
    expectPass(ctx.output || runLivenessTest(ctx), 'front-desk-liveness-04: repeated stalls stop restarting at the cap (gives up)');
  });

  // ── front-desk-liveness-means-listening-05 ──────────────────────────
  registry.define(/^the escalation to the human fails to send$/, (ctx) => {
    ctx.output = ctx.output || runLivenessTest(ctx);
    expectPass(ctx.output, 'front-desk-liveness-05: a failed escalation send is NOT armed (never silenced on a mere attempt)');
  });
  registry.define(/^the supervisor evaluates the escalation again$/, (ctx) => {
    ctx.output = ctx.output || runLivenessTest(ctx);
  });
  registry.define(/^it attempts the escalation again$/, (ctx) => {
    expectPass(ctx.output || runLivenessTest(ctx), 'front-desk-liveness-05: the supervisor attempts the escalation again on the next check');
  });
}

module.exports = { registerSteps };
