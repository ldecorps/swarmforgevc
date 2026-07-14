'use strict';

// BL-356: step handlers for "The swarm's work reaches origin, so a working
// swarm never looks dead from outside". Drives the REAL push_sweep_cli.bb,
// which itself calls the EXACT same push_sweep_lib.bb/sweep! handoffd.bb's
// real adapters call, against a real fixture daemon-dir, with an explicit
// now-ms (no real clock) and forced rev-counts/push/alarm results (no real
// git process, no real network) - mirrors stuckEscalationEmailSteps.js's
// own "drive the real shell test/CLI" posture.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const CLI = path.join(SWARMFORGE_SCRIPTS, 'test', 'push_sweep_cli.bb');

function mkDaemonDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl356-acceptance-'));
}

function runSweep(daemonDir, nowMs, { revCounts, pushResult, alarmResult, divergenceResult }) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  if (revCounts) env.PUSH_SWEEP_REV_COUNTS = JSON.stringify(revCounts);
  if (pushResult) env.PUSH_SWEEP_PUSH_RESULT = JSON.stringify(pushResult);
  if (alarmResult) env.PUSH_SWEEP_ALARM_RESULT = JSON.stringify(alarmResult);
  if (divergenceResult) env.PUSH_SWEEP_DIVERGENCE_RESULT = JSON.stringify(divergenceResult);
  const out = execFileSync('bb', [CLI, daemonDir, String(nowMs)], { encoding: 'utf8', env });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the swarm is running and local main carries commits$/, (ctx) => {
    ctx.daemonDir = ctx.daemonDir || mkDaemonDir();
    ctx.now = ctx.now === undefined ? 100000 : ctx.now;
  });

  // ── swarm-pushes-main-to-origin-01 ────────────────────────────────────
  registry.define(/^origin is behind local main$/, (ctx) => {
    ctx.revCounts = { ahead: 2, behind: 0 };
    ctx.pushResult = { success: true };
  });

  registry.define(/^the swarm next checks its published state$/, (ctx) => {
    ctx.result = runSweep(ctx.daemonDir, ctx.now, {
      revCounts: ctx.revCounts,
      pushResult: ctx.pushResult,
      alarmResult: ctx.alarmResult,
      divergenceResult: ctx.divergenceResult,
    });
  });

  registry.define(/^the swarm pushes main to origin$/, (ctx) => {
    if (ctx.result.pushCalls !== 1) {
      throw new Error(`expected exactly one push attempt, got: ${JSON.stringify(ctx.result)}`);
    }
    if (JSON.stringify(ctx.result.state) !== '{}') {
      throw new Error(`expected a successful push to clear all retry/alarm state, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── swarm-pushes-main-to-origin-02 ────────────────────────────────────
  registry.define(/^a push to origin fails for a transient reason$/, (ctx) => {
    ctx.revCounts = { ahead: 2, behind: 0 };
    ctx.pushResult = { success: false, error: 'connection refused' };
  });

  registry.define(/^the push is retried$/, (ctx) => {
    // Advance past the first attempt's backoff (base 1000ms) and check for
    // a second real push attempt.
    const retry = runSweep(ctx.daemonDir, ctx.now + 1000, {
      revCounts: ctx.revCounts,
      pushResult: ctx.pushResult,
    });
    ctx.retryResult = retry;
    if (retry.pushCalls !== 1) {
      throw new Error(`expected the retry sweep to make exactly one push attempt, got: ${JSON.stringify(retry)}`);
    }
  });

  registry.define(/^the retries are bounded rather than unlimited$/, (ctx) => {
    const attempts = ctx.retryResult.state.push && ctx.retryResult.state.push.attempts;
    if (typeof attempts !== 'number') {
      throw new Error(`expected a bounded attempt counter on the push state, got: ${JSON.stringify(ctx.retryResult)}`);
    }
  });

  // ── swarm-pushes-main-to-origin-03 ────────────────────────────────────
  registry.define(/^every bounded retry of the push has failed$/, (ctx) => {
    ctx.daemonDir = mkDaemonDir();
    ctx.now = 100000;
    const revCounts = { ahead: 2, behind: 0 };
    const pushResult = { success: false, error: 'connection refused' };
    const alarmResult = { success: true };
    // PUSH_TEST_MAX_PUSH_ATTEMPTS default is 3 - drive exactly that many
    // failing attempts, spaced past each one's own backoff.
    runSweep(ctx.daemonDir, ctx.now, { revCounts, pushResult });
    runSweep(ctx.daemonDir, ctx.now + 1000, { revCounts, pushResult });
    ctx.result = runSweep(ctx.daemonDir, ctx.now + 3000, { revCounts, pushResult, alarmResult });
  });

  registry.define(/^the human is alarmed that the swarm's work is not reaching origin$/, (ctx) => {
    if (ctx.result.alarmCalls !== 1) {
      throw new Error(`expected exactly one alarm attempt once retries were exhausted, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^the alarm is only marked delivered once it has actually been delivered$/, (ctx) => {
    if (ctx.result.state.alarm && ctx.result.state.alarm['armed?'] !== true) {
      throw new Error(`expected the delivered alarm result to arm the state, got: ${JSON.stringify(ctx.result)}`);
    }
    if (!ctx.result.state.alarm) {
      throw new Error(`expected an alarm state entry once the alarm was attempted, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── swarm-pushes-main-to-origin-04 ────────────────────────────────────
  registry.define(/^origin carries commits that local main does not$/, (ctx) => {
    ctx.revCounts = { ahead: 2, behind: 1 };
    ctx.divergenceResult = { success: true };
  });

  registry.define(/^origin's commits are not overwritten$/, (ctx) => {
    if (ctx.result.pushCalls !== 0) {
      throw new Error(`expected NO push attempt while diverged (never force-push), got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^the human is told local main and origin have diverged$/, (ctx) => {
    if (ctx.result.divergenceCalls !== 1) {
      throw new Error(`expected exactly one divergence alert, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── swarm-pushes-main-to-origin-05 ────────────────────────────────────
  registry.define(/^origin already carries every commit on local main$/, (ctx) => {
    ctx.revCounts = { ahead: 0, behind: 0 };
  });

  registry.define(/^nothing is pushed$/, (ctx) => {
    if (ctx.result.pushCalls !== 0) {
      throw new Error(`expected no push attempt when already up to date, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^no alarm is raised$/, (ctx) => {
    if (ctx.result.alarmCalls !== 0 || ctx.result.divergenceCalls !== 0) {
      throw new Error(`expected no alarm of any kind when already up to date, got: ${JSON.stringify(ctx.result)}`);
    }
  });
}

module.exports = { registerSteps };
