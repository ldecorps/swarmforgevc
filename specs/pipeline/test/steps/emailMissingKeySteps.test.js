'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/emailMissingKeySteps');

// BL-215 hardening: matching the established convention (see
// rateLimitCooldownSteps.test.js/dispatchGapSteps.test.js/etc.) - the 4/4
// Gherkin scenario run only exercises the happy path, so a regression in an
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

// ── the send returns a distinct "missing key" result ────────────────────

test('the send returns a distinct "missing key" result fails loudly on a different reason', () => {
  const registry = freshRegistry();
  const ctx = { result: { reason: 'disabled' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the send returns a distinct "missing key" result'),
    /expected reason "missing-api-key"/
  );
});

test('the send returns a distinct "missing key" result passes when the reason matches', () => {
  const registry = freshRegistry();
  const ctx = { result: { reason: 'missing-api-key' } };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the send returns a distinct "missing key" result'));
});

// ── the daemon logs a visible warning naming RESEND_API_KEY ─────────────

test('the daemon logs a visible warning naming RESEND_API_KEY fails loudly when nothing was logged', () => {
  const registry = freshRegistry();
  const ctx = { result: { warnings: [] } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the daemon logs a visible warning naming RESEND_API_KEY'),
    /expected a warning naming RESEND_API_KEY/
  );
});

test('the daemon logs a visible warning naming RESEND_API_KEY fails loudly when the warning omits the var name', () => {
  const registry = freshRegistry();
  const ctx = { result: { warnings: ['email cannot send'] } };
  assert.throws(() => resolveAndRun(registry, ctx, 'the daemon logs a visible warning naming RESEND_API_KEY'));
});

test('the daemon logs a visible warning naming RESEND_API_KEY passes when it names the var', () => {
  const registry = freshRegistry();
  const ctx = { result: { warnings: ['missing RESEND_API_KEY'] } };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the daemon logs a visible warning naming RESEND_API_KEY'));
});

// ── no email is sent ─────────────────────────────────────────────────────

test('no email is sent fails loudly when an email was sent anyway', () => {
  const registry = freshRegistry();
  const ctx = { result: { emailsSent: 1 } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'no email is sent'),
    /expected no email sent/
  );
});

test('no email is sent passes when emailsSent is zero', () => {
  const registry = freshRegistry();
  const ctx = { result: { emailsSent: 0 } };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'no email is sent'));
});

// ── no missing-key warning is logged ────────────────────────────────────

test('no missing-key warning is logged fails loudly when one was logged anyway', () => {
  const registry = freshRegistry();
  const ctx = { result: { warnings: ['missing RESEND_API_KEY'] } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'no missing-key warning is logged'),
    /expected no missing-key warning/
  );
});

test('no missing-key warning is logged passes when warnings is empty', () => {
  const registry = freshRegistry();
  const ctx = { result: { warnings: [] } };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'no missing-key warning is logged'));
});

// ── the email is posted ──────────────────────────────────────────────────

test('the email is posted fails loudly when no email was actually sent', () => {
  const registry = freshRegistry();
  const ctx = { result: { emailsSent: 0 } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the email is posted'),
    /expected exactly one email posted/
  );
});

test('the email is posted passes when exactly one email was sent', () => {
  const registry = freshRegistry();
  const ctx = { result: { emailsSent: 1 } };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the email is posted'));
});

// ── the missing-key warning is logged at most once per dedup window ────

test('the missing-key warning is logged at most once per dedup window fails loudly when spammed', () => {
  const registry = freshRegistry();
  const ctx = { result: { warnings: ['a', 'b', 'c'] } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the missing-key warning is logged at most once per dedup window'),
    /expected exactly one deduped warning/
  );
});

test('the missing-key warning is logged at most once per dedup window fails loudly when never logged', () => {
  const registry = freshRegistry();
  const ctx = { result: { warnings: [] } };
  assert.throws(() =>
    resolveAndRun(registry, ctx, 'the missing-key warning is logged at most once per dedup window')
  );
});

test('the missing-key warning is logged at most once per dedup window passes when logged exactly once', () => {
  const registry = freshRegistry();
  const ctx = { result: { warnings: ['missing RESEND_API_KEY'] } };
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'the missing-key warning is logged at most once per dedup window')
  );
});
