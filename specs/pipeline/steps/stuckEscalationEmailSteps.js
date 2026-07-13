'use strict';

// BL-349: step handlers for "A role stuck past escalation reaches the
// human even when nobody has an editor open". Drives the REAL
// stuck_escalation_email_sweep_cli.bb, which itself calls the EXACT same
// two functions handoffd.bb's real :on-stuck-escalation! adapter calls
// (chase_sweep_lib.bb's write-escalation!, then
// stuck_escalation_email_lib.bb's sweep!) against a real fixture
// daemon-dir, with an explicit now-ms (no real clock) and
// STUCK_ESCALATION_EMAIL_FORCE_RESULT (no real network) - mirrors
// frontDeskStarvationAlarmSteps.js's own "drive the real shell test/CLI"
// posture. The one genuinely real-daemon, real-60s-wall-clock wiring
// proof (that handoffd.bb's actual :on-stuck-escalation! closure reaches
// this sweep at all) lives once, in
// test_handoffd_stuck_escalation_email_wiring.sh - not re-run per
// scenario here.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const CLI = path.join(SWARMFORGE_SCRIPTS, 'test', 'stuck_escalation_email_sweep_cli.bb');

const ROLE = 'coder';
const FORCE_SUCCESS = JSON.stringify({ success: true, status: 200 });
const FORCE_TRANSIENT = JSON.stringify({ success: false, status: 503 });
const FORCE_TERMINAL = JSON.stringify({ success: false, reason: 'missing-api-key' });

function mkDaemonDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl349-acceptance-'));
}

// escalated is 'true'/'false' (string, matching the CLI's own positional
// arg parsing); forceResult is only required (and only ever read) when a
// send is actually due this call - a call that never attempts a send
// (already armed, or escalated=false) never needs it, and the CLI itself
// throws loudly if a send WAS attempted with none set, so an unexpected
// send in a "should not send" step fails the test rather than passing by
// accident.
function runSweep(daemonDir, escalated, nowMs, forceResult) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  if (forceResult) {
    env.STUCK_ESCALATION_EMAIL_FORCE_RESULT = forceResult;
  }
  const out = execFileSync('bb', [CLI, daemonDir, ROLE, escalated, String(nowMs)], { encoding: 'utf8', env });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a swarm running headless, with no editor attached$/, () => {
    // Narrative only - the whole point of BL-336's finding H4: the ONLY
    // code that emailed this signal lived in the VS Code extension host.
    // Every fixture here drives the daemon-side lib directly, never the
    // extension host, proving the headless leg specifically.
  });

  // ── stuck-escalation-email-headless-01 / -02 (shared Given/When) ────
  registry.define(/^a role that has been stuck past its escalation threshold$/, (ctx) => {
    ctx.daemonDir = ctx.daemonDir || mkDaemonDir();
    ctx.now = ctx.now === undefined ? 100000 : ctx.now;
  });

  registry.define(/^the escalation is detected$/, (ctx) => {
    ctx.result = runSweep(ctx.daemonDir, 'true', ctx.now, ctx.forceResult || FORCE_SUCCESS);
  });

  registry.define(/^the human is emailed about that role$/, (ctx) => {
    if (ctx.result.sendCalls !== 1) {
      throw new Error(`expected exactly one send attempt, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^the escalation is recorded$/, (ctx) => {
    if (ctx.result.escalationRecorded !== true) {
      throw new Error(`expected write-escalation!'s own record to still be written, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── stuck-escalation-email-headless-03 ────────────────────────────────
  registry.define(/^a role that has already been escalated and emailed about$/, (ctx) => {
    ctx.daemonDir = mkDaemonDir();
    ctx.now = 100000;
    const first = runSweep(ctx.daemonDir, 'true', ctx.now, FORCE_SUCCESS);
    if (first.sendCalls !== 1) {
      throw new Error(`setup: expected the first escalation to send, got: ${JSON.stringify(first)}`);
    }
  });

  registry.define(/^the role is still stuck on the next sweep$/, (ctx) => {
    // No forceResult - already armed means should-attempt? is false, so
    // no send is attempted at all; if a regression DID attempt one, the
    // CLI throws for lack of a forced result, failing this step loudly.
    ctx.result = runSweep(ctx.daemonDir, 'true', ctx.now + 50000);
  });

  registry.define(/^the human is not emailed about it again$/, (ctx) => {
    if (ctx.result.sendCalls !== 0) {
      throw new Error(`expected NO further send attempt while still armed, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── stuck-escalation-email-headless-04 ────────────────────────────────
  registry.define(/^a role that was escalated, emailed about, and then recovered$/, (ctx) => {
    ctx.daemonDir = mkDaemonDir();
    ctx.now = 100000;
    const first = runSweep(ctx.daemonDir, 'true', ctx.now, FORCE_SUCCESS);
    if (first.sendCalls !== 1) {
      throw new Error(`setup: expected the first escalation to send, got: ${JSON.stringify(first)}`);
    }
    const recovered = runSweep(ctx.daemonDir, 'false', ctx.now + 50000);
    if (recovered.state !== null) {
      throw new Error(`setup: expected recovery to clear the per-role state, got: ${JSON.stringify(recovered)}`);
    }
  });

  registry.define(/^that role becomes stuck past its escalation threshold again$/, (ctx) => {
    ctx.result = runSweep(ctx.daemonDir, 'true', ctx.now + 100000, FORCE_SUCCESS);
  });

  registry.define(/^the human is emailed about it again$/, (ctx) => {
    if (ctx.result.sendCalls !== 1) {
      throw new Error(`expected a fresh send attempt after recovery + re-escalation, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── stuck-escalation-email-headless-05 ────────────────────────────────
  registry.define(/^the email send fails for a transient reason$/, (ctx) => {
    ctx.forceResult = FORCE_TRANSIENT;
  });

  registry.define(/^the escalation is not treated as notified$/, (ctx) => {
    if (ctx.result.state['armed?'] !== false) {
      throw new Error(`expected a transient failure to leave the state UNARMED, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^it is attempted again$/, (ctx) => {
    // retry-config defaults (in the CLI): backoff-base-ms 1000, attempt 1
    // -> 1000ms backoff - the retry is due once that has elapsed.
    const retry = runSweep(ctx.daemonDir, 'true', ctx.now + 1000, FORCE_SUCCESS);
    if (retry.sendCalls !== 1) {
      throw new Error(`expected a real retry attempt once backoff elapsed, got: ${JSON.stringify(retry)}`);
    }
  });

  // ── stuck-escalation-email-headless-06 ────────────────────────────────
  registry.define(/^the email can never be delivered$/, (ctx) => {
    ctx.forceResult = FORCE_TERMINAL;
  });

  registry.define(/^the undelivered escalation is reported$/, (ctx) => {
    if (ctx.result.state['armed?'] !== true) {
      throw new Error(`expected a terminal misconfiguration to arm immediately (never retried), got: ${JSON.stringify(ctx.result)}`);
    }
    const reported = ctx.result.logLines.some((line) => line.includes('terminal-misconfig'));
    if (!reported) {
      throw new Error(`expected the undelivered escalation to be logged loudly, got: ${JSON.stringify(ctx.result.logLines)}`);
    }
  });

  // ── stuck-escalation-email-headless-07 ────────────────────────────────
  // "the sweep runs" is dispatchGapSteps.js's own step text (registered
  // earlier in specs/pipeline/steps/index.js's DOMAINS array, so it wins
  // first-match) - this Given instead hands it a ctx.stuckEscalationRunner
  // closure to delegate to, per that file's own documented branch-on-flag
  // convention, rather than defining a second, silently-shadowed handler
  // here.
  registry.define(/^no role is stuck past its escalation threshold$/, (ctx) => {
    ctx.daemonDir = mkDaemonDir();
    ctx.now = 100000;
    // No forceResult - a not-escalated sweep never attempts a send at
    // all; an unexpected attempt would throw for lack of a forced result.
    ctx.stuckEscalationRunner = () => runSweep(ctx.daemonDir, 'false', ctx.now);
  });

  registry.define(/^no escalation email is sent$/, (ctx) => {
    if (ctx.result.sendCalls !== 0) {
      throw new Error(`expected no send attempt when no role is stuck, got: ${JSON.stringify(ctx.result)}`);
    }
  });
}

module.exports = { registerSteps };
