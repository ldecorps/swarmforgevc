'use strict';

// BL-412: step handlers for "proactive Telegram alert before the swarm's
// disk fills". Drives the REAL pure decision function (disk_space_lib.bb's
// disk-space-decision) via disk_space_decision_acceptance_runner.bb - the
// same Babashka-runner pattern bl403SupervisorKillsSupersededChildSteps.js
// already established - never a hand-rolled reimplementation of the
// decision in JS. The live df read + reply-outbox wiring is proven
// separately by swarmforge/scripts/test/test_operator_runtime_disk_space_sweep.sh
// (a shell wiring test, since it drives a real --tick-once subprocess).
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'disk_space_decision_acceptance_runner.bb');

// A reading for each named level, tuned against disk_space_lib.bb's own
// default /mnt/c thresholds (warn < 40 GB, critical < 15 GB free) - the
// KNOWN_VALUES lookup the engineering article's own Scenario Outline rule
// requires: an unrecognized level value throws rather than silently
// falling through, so a mutated Examples cell fails loudly here.
const KNOWN_READINGS = new Map([
  ['healthy', { free_gb: 200, used_pct: 30 }],
  ['warn', { free_gb: 30, used_pct: 92 }],
  ['critical', { free_gb: 10, used_pct: 97 }],
]);

function knownReading(level) {
  if (!KNOWN_READINGS.has(level)) {
    throw new Error(`disk-space-alert: unrecognized level "${level}"`);
  }
  return KNOWN_READINGS.get(level);
}

function runDecision(readings, priorState) {
  const out = execFileSync('bb', [RUNNER, JSON.stringify({ readings, priorState })], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a disk-space monitor evaluating free space on each watched filesystem against WARN and CRITICAL thresholds$/, (ctx) => {
    ctx.priorState = {};
  });

  // ── disk-space-alert-01 (Scenario Outline) ────────────────────────────
  registry.define(/^a watched filesystem previously at level "([^"]+)"$/, (ctx, prev) => {
    ctx.priorState = { 'mnt-c': prev };
  });

  registry.define(/^a check finds its free space now at level "([^"]+)"$/, (ctx, now) => {
    ctx.now = now;
    ctx.result = runDecision({ 'mnt-c': knownReading(now) }, ctx.priorState);
  });

  registry.define(/^a single "([^"]+)" alert is delivered naming the mount, free amount, and free percent$/, (ctx, now) => {
    if (ctx.result.messages.length !== 1) {
      throw new Error(`expected exactly one message, got: ${JSON.stringify(ctx.result.messages)}`);
    }
    const [message] = ctx.result.messages;
    if (message.level !== now) {
      throw new Error(`expected the message level to be "${now}", got: ${message.level}`);
    }
    if (!message.text.includes('/mnt/c')) {
      throw new Error(`expected the message to name the mount, got: ${message.text}`);
    }
    const reading = knownReading(now);
    if (!message.text.includes(String(reading.free_gb)) || !message.text.includes(String(reading.used_pct))) {
      throw new Error(`expected the message to name the free amount and percent, got: ${message.text}`);
    }
  });

  registry.define(/^the monitor records "([^"]+)" as the last-announced level for that filesystem$/, (ctx, level) => {
    if (ctx.result.nextState['mnt-c'] !== level) {
      throw new Error(`expected next-state mnt-c to be "${level}", got: ${JSON.stringify(ctx.result.nextState)}`);
    }
  });

  // ── disk-space-alert-02 ────────────────────────────────────────────────
  registry.define(/^a watched filesystem whose last-announced level is "([^"]+)"$/, (ctx, level) => {
    ctx.priorState = { 'mnt-c': level };
  });

  registry.define(/^a check finds its free space still at level "([^"]+)"$/, (ctx, level) => {
    ctx.result = runDecision({ 'mnt-c': knownReading(level) }, ctx.priorState);
  });

  registry.define(/^no alert is delivered$/, (ctx) => {
    if (ctx.result.messages.length !== 0) {
      throw new Error(`expected no messages, got: ${JSON.stringify(ctx.result.messages)}`);
    }
  });

  registry.define(/^the last-announced level for that filesystem stays "([^"]+)"$/, (ctx, level) => {
    if (ctx.result.nextState['mnt-c'] !== level) {
      throw new Error(`expected next-state mnt-c to stay "${level}", got: ${JSON.stringify(ctx.result.nextState)}`);
    }
  });

  // ── disk-space-alert-03 ────────────────────────────────────────────────
  registry.define(/^a check finds its free space back above the warn threshold$/, (ctx) => {
    ctx.result = runDecision({ 'mnt-c': knownReading('healthy') }, ctx.priorState);
  });

  registry.define(/^a single recovery alert is delivered for that filesystem$/, (ctx) => {
    if (ctx.result.messages.length !== 1 || ctx.result.messages[0].level !== 'healthy') {
      throw new Error(`expected exactly one recovery (healthy) message, got: ${JSON.stringify(ctx.result.messages)}`);
    }
  });

  // (scenario 03's "the monitor records..." Then reuses the SAME step text
  // and handler already registered for scenario 01, above.)

  // ── disk-space-alert-04 ─────────────────────────────────────────────────
  registry.define(/^the WSL root filesystem is healthy and the \/mnt\/c filesystem is at level "([^"]+)"$/, (ctx, level) => {
    ctx.readings = { 'wsl-root': knownReading('healthy'), 'mnt-c': knownReading(level) };
    ctx.priorState = { 'wsl-root': 'healthy', 'mnt-c': 'healthy' };
  });

  registry.define(/^a check runs$/, (ctx) => {
    ctx.result = runDecision(ctx.readings, ctx.priorState);
  });

  registry.define(/^a "([^"]+)" alert is delivered for \/mnt\/c only$/, (ctx, level) => {
    if (ctx.result.messages.length !== 1) {
      throw new Error(`expected exactly one message, got: ${JSON.stringify(ctx.result.messages)}`);
    }
    const [message] = ctx.result.messages;
    if (message.mount !== 'mnt-c' || message.level !== level) {
      throw new Error(`expected a "${level}" message for mnt-c only, got: ${JSON.stringify(message)}`);
    }
  });

  registry.define(/^no alert is delivered for the WSL root filesystem$/, (ctx) => {
    if (ctx.result.messages.some((m) => m.mount === 'wsl-root')) {
      throw new Error(`expected no wsl-root message, got: ${JSON.stringify(ctx.result.messages)}`);
    }
  });
}

module.exports = { registerSteps };
