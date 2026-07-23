'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/briefingEmailSteps');

// BL-214 hardening: matching the established convention (see
// emailMissingKeySteps.test.js/rateLimitCooldownSteps.test.js/etc.) - the
// 4/4 Gherkin scenario run only exercises the happy path, so a regression
// in an assertion step's own failure branch would pass the feature run and
// go unnoticed. This file closes that gap.

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

// ── it sends that briefing once via send-alarm-email! ───────────────────

test('it sends that briefing once via send-alarm-email! fails loudly when nothing was sent', () => {
  const registry = freshRegistry();
  const ctx = { result: { emailsSent: 0, sent: [] } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it sends that briefing once via send-alarm-email!'),
    /expected the briefing sent exactly once/
  );
});

test('it sends that briefing once via send-alarm-email! passes on exactly one send', () => {
  const registry = freshRegistry();
  const ctx = { result: { emailsSent: 1, sent: ['2026-07-09.md'] } };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'it sends that briefing once via send-alarm-email!'));
});

// ── the send uses the daemon's configured to/from and RESEND_API_KEY ────

test("the send uses the daemon's configured to/from and RESEND_API_KEY passes against the real handoffd.bb", () => {
  const registry = freshRegistry();
  const ctx = {};
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, "the send uses the daemon's configured to/from and RESEND_API_KEY")
  );
});

// ── no second email is sent for that briefing ───────────────────────────

test('no second email is sent for that briefing fails loudly when a second send happened', () => {
  const registry = freshRegistry();
  const ctx = { result: { emailsSent: 1, sent: ['2026-07-09.md'] } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'no second email is sent for that briefing'),
    /expected no second send/
  );
});

test('no second email is sent for that briefing passes when nothing was sent again', () => {
  const registry = freshRegistry();
  const ctx = { result: { emailsSent: 0, sent: [] } };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'no second email is sent for that briefing'));
});

// ── it logs the skip and sends nothing ──────────────────────────────────

test('it logs the skip and sends nothing fails loudly when an email was sent anyway', () => {
  const registry = freshRegistry();
  const ctx = { result: { emailsSent: 1, logs: [['briefing-sent', 'x.md']] } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it logs the skip and sends nothing'),
    /expected no email sent when unconfigured/
  );
});

test('it logs the skip and sends nothing fails loudly when no skip was logged', () => {
  const registry = freshRegistry();
  const ctx = { result: { emailsSent: 0, logs: [] } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it logs the skip and sends nothing'),
    /expected a logged skip/
  );
});

test('it logs the skip and sends nothing passes on a missing-api-key skip', () => {
  const registry = freshRegistry();
  const ctx = { result: { emailsSent: 0, logs: [['briefing-skip-missing-key', 'x.md']] } };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'it logs the skip and sends nothing'));
});

test('it logs the skip and sends nothing passes on a disabled skip', () => {
  const registry = freshRegistry();
  const ctx = { result: { emailsSent: 0, logs: [['briefing-skip-disabled', 'x.md']] } };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'it logs the skip and sends nothing'));
});

// ── the daemon does not crash ────────────────────────────────────────────

test('the daemon does not crash fails loudly when no result was ever produced', () => {
  const registry = freshRegistry();
  const ctx = {};
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the daemon does not crash'),
    /expected the harness to have run/
  );
});

test('the daemon does not crash passes once a result exists', () => {
  const registry = freshRegistry();
  const ctx = { result: { emailsSent: 0, logs: [] } };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the daemon does not crash'));
});

// ── the host does not also email the briefing ───────────────────────────

test('the host does not also email the briefing passes against the real (retired) extension', () => {
  const registry = freshRegistry();
  const ctx = {};
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the host does not also email the briefing'));
});

test('the host does not also email the briefing fails loudly if the retired module reappears', () => {
  const registry = freshRegistry();
  const tmpModule = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'extension',
    'src',
    'notify',
    'briefingEmailWatcher.ts'
  );
  fs.mkdirSync(path.dirname(tmpModule), { recursive: true });
  fs.writeFileSync(tmpModule, '// temporary regression-test fixture\n');
  try {
    assert.throws(
      () => resolveAndRun(registry, {}, 'the host does not also email the briefing'),
      /expected briefingEmailWatcher\.ts to be retired/
    );
  } finally {
    fs.rmSync(tmpModule);
  }
});
