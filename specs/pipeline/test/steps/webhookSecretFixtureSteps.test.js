'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/webhookSecretFixtureSteps');

// BL-225 hardening: matching the established convention (see
// recertAddressSteps.test.js/briefingEmailSteps.test.js/etc.) - the 3/3
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

// ── no tracked file contains one ────────────────────────────────────────

test('no tracked file contains one fails loudly when a match was found', () => {
  const registry = freshRegistry();
  const ctx = { whsecMatches: 'some/file.js:1:whsec_abc123' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'no tracked file contains one'),
    /expected zero whsec_ high-entropy literals/
  );
});

test('no tracked file contains one passes when nothing was found', () => {
  const registry = freshRegistry();
  const ctx = { whsecMatches: '' };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'no tracked file contains one'));
});

// ── the signature accept and reject tests pass exactly as before ───────

test('the signature accept and reject tests pass exactly as before fails loudly on a failed run', () => {
  const registry = freshRegistry();
  const ctx = { testResult: 'Test Files  1 failed (2)\n Tests  1 failed | 24 passed (25)' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the signature accept and reject tests pass exactly as before'),
    /expected the signature test suite to pass cleanly/
  );
});

test('the signature accept and reject tests pass exactly as before passes on a clean run', () => {
  const registry = freshRegistry();
  const ctx = { testResult: 'Test Files  2 passed (2)\n Tests  25 passed (25)' };
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'the signature accept and reject tests pass exactly as before')
  );
});

// ── its reproduction snippet builds the secret at runtime or shows a redacted placeholder ──

test('the reproduction-snippet step fails loudly when the evidence doc still embeds the literal', () => {
  const registry = freshRegistry();
  // Built at runtime, not a source-text literal: this file is itself
  // git-grepped by noWebhookSecretLiteral.test.js's regression guard, so
  // even a FAKE whsec_+base64 literal here would trip it the same as a
  // real one - the guard is shape-based, not content-aware.
  const fakeLiteral = 'whsec_' + Buffer.from('some-other-fake-seed').toString('base64');
  const ctx = { evidenceDoc: `const SECRET = '${fakeLiteral}';\nBuffer.from('x')` };
  assert.throws(
    () =>
      resolveAndRun(
        registry,
        ctx,
        'its reproduction snippet builds the secret at runtime or shows a redacted placeholder, never a whsec_ literal'
      ),
    /expected the evidence doc to no longer embed the whsec_ literal/
  );
});

test('the reproduction-snippet step fails loudly when neither a runtime build nor a redaction is present', () => {
  const registry = freshRegistry();
  const ctx = { evidenceDoc: "const SECRET = 'some other value';" };
  assert.throws(
    () =>
      resolveAndRun(
        registry,
        ctx,
        'its reproduction snippet builds the secret at runtime or shows a redacted placeholder, never a whsec_ literal'
      ),
    /expected the evidence doc's reproduction snippet to build the secret at runtime/
  );
});

test('the reproduction-snippet step passes when the secret is built at runtime', () => {
  const registry = freshRegistry();
  const ctx = { evidenceDoc: "const SECRET = 'whsec_' + Buffer.from('seed').toString('base64');" };
  assert.doesNotThrow(() =>
    resolveAndRun(
      registry,
      ctx,
      'its reproduction snippet builds the secret at runtime or shows a redacted placeholder, never a whsec_ literal'
    )
  );
});
