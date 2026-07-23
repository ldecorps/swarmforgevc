'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/rateLimitCooldownSteps');

// BL-209 hardening: matching the established convention (see
// dispatchGapSteps.test.js/backlogDepthSteps.test.js/etc.) - the 4/4 Gherkin
// scenario run only exercises the happy path, so a regression in an
// assertion step's own failure branch would pass the feature run and go
// unnoticed. This file closes that gap.

function freshRegistry() {
  const registry = createStepRegistry();
  registerSteps(registry);
  return registry;
}

function resolveAndRun(registry, ctx, stepText) {
  const resolved = registry.resolve(stepText);
  if (!resolved) {
    throw new Error(`no step handler matched "${stepText}"`);
  }
  return resolved.handler(ctx, ...resolved.args);
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-rate-limit-cooldown-test-'));
}

// ── a cooldown is recorded for that role until the parsed reset time ────

test('a cooldown is recorded for that role until the parsed reset time fails loudly when nothing was recorded', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp(), role: 'coder' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'a cooldown is recorded for that role until the parsed reset time'),
    /expected a cooldown for coder/
  );
});

test('a cooldown is recorded for that role until the parsed reset time fails loudly on a wrong until-ms', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp(), role: 'coder' };
  fs.mkdirSync(path.join(ctx.targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(ctx.targetPath, '.swarmforge', 'rate-limit-cooldown.json'),
    JSON.stringify({ coder: { untilMs: 1 } })
  );
  assert.throws(() =>
    resolveAndRun(registry, ctx, 'a cooldown is recorded for that role until the parsed reset time')
  );
});

test('a cooldown is recorded for that role until the parsed reset time passes when correctly recorded', () => {
  const registry = freshRegistry();
  const ctx = {
    targetPath: mkTmp(),
    role: 'coder',
    paneText: 'usage limit reached, resets at 18:00',
    nowMs: new Date('2026-07-10T17:00:00Z').getTime(),
  };
  resolveAndRun(registry, ctx, 'the extension processes that pane output');
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'a cooldown is recorded for that role until the parsed reset time')
  );
});

// ── no rate-limit cooldown is recorded ──────────────────────────────────

test('no rate-limit cooldown is recorded fails loudly when one was recorded anyway', () => {
  const registry = freshRegistry();
  const ctx = {
    targetPath: mkTmp(),
    role: 'coder',
    paneText: 'usage limit reached, resets at 18:00',
    nowMs: new Date('2026-07-10T17:00:00Z').getTime(),
  };
  resolveAndRun(registry, ctx, 'the extension processes that pane output');
  assert.throws(
    () => resolveAndRun(registry, ctx, 'no rate-limit cooldown is recorded'),
    /expected no cooldown recorded for coder/
  );
});

test('no rate-limit cooldown is recorded passes when nothing was recorded', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp(), role: 'coder' };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'no rate-limit cooldown is recorded'));
});

// ── it does not send that role a wake or retry ──────────────────────────

test('it does not send that role a wake or retry fails loudly when the sweep produced any call', () => {
  const registry = freshRegistry();
  const ctx = { sweepRoot: mkTmp() };
  fs.writeFileSync(path.join(ctx.sweepRoot, 'calls.log'), 'wake-up coder\n');
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it does not send that role a wake or retry'),
    /expected no wake\/retry calls while cooling down/
  );
});

test('it does not send that role a wake or retry passes when the log is empty', () => {
  const registry = freshRegistry();
  const ctx = { sweepRoot: mkTmp() };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'it does not send that role a wake or retry'));
});

// ── the role is woken once to resume work ───────────────────────────────

test('the role is woken once to resume work fails loudly when no wake-up call happened', () => {
  const registry = freshRegistry();
  const ctx = { sweepRoot: mkTmp() };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the role is woken once to resume work'),
    /expected the role to be woken once/
  );
});

test('the role is woken once to resume work passes when a wake-up call happened', () => {
  const registry = freshRegistry();
  const ctx = { sweepRoot: mkTmp() };
  fs.writeFileSync(path.join(ctx.sweepRoot, 'calls.log'), 'wake-up coder\n');
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the role is woken once to resume work'));
});

// ── its rate-limit cooldown is cleared so it does not re-trigger ───────

test('its rate-limit cooldown is cleared so it does not re-trigger fails loudly when the woken marker is missing', () => {
  const registry = freshRegistry();
  const ctx = { sweepRoot: mkTmp() };
  fs.writeFileSync(path.join(ctx.sweepRoot, 'rate-limit-cooldown.json'), JSON.stringify({ coder: { untilMs: -1000 } }));
  assert.throws(
    () => resolveAndRun(registry, ctx, 'its rate-limit cooldown is cleared so it does not re-trigger'),
    /expected the cooldown marked woken/
  );
});

test('its rate-limit cooldown is cleared so it does not re-trigger passes once the woken marker matches', () => {
  const registry = freshRegistry();
  const ctx = { sweepRoot: mkTmp() };
  // Must match the step handler's own hardcoded expectation (the same
  // NOW_MS - 1000 every "reset time has passed" fixture in this domain uses).
  const untilMs = 1751500000 * 1000 - 1000;
  fs.writeFileSync(
    path.join(ctx.sweepRoot, 'rate-limit-cooldown.json'),
    JSON.stringify({ coder: { untilMs, wokenForUntilMs: untilMs } })
  );
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'its rate-limit cooldown is cleared so it does not re-trigger')
  );
});
