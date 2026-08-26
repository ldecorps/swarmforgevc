'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/recertAddressSteps');

// BL-223 hardening: matching the established convention (see
// briefingEmailSteps.test.js/emailMissingKeySteps.test.js/etc.) - the 2/2
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

// ── the composed mailto is addressed to that configured address ────────

test('the composed mailto is addressed to that configured address fails loudly on a mismatch', () => {
  const registry = freshRegistry();
  const ctx = { configuredAddress: 'recert@inbound.musicalsifu.com', mail: { to: 'recert@tolokarooo.resend.app' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the composed mailto is addressed to that configured address'),
    /expected the mailto addressed to recert@inbound\.musicalsifu\.com/
  );
});

test('the composed mailto is addressed to that configured address passes on a match', () => {
  const registry = freshRegistry();
  const ctx = { configuredAddress: 'recert@inbound.musicalsifu.com', mail: { to: 'recert@inbound.musicalsifu.com' } };
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'the composed mailto is addressed to that configured address')
  );
});

// ── the address is not on the reserved .invalid TLD ─────────────────────

test('the address is not on the reserved .invalid TLD fails loudly when it is', () => {
  const registry = freshRegistry();
  const ctx = { mail: { to: 'recert@swarmforge.invalid' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the address is not on the reserved .invalid TLD'),
    /expected the address to never be on the reserved \.invalid TLD/
  );
});

test('the address is not on the reserved .invalid TLD passes for a real domain', () => {
  const registry = freshRegistry();
  const ctx = { mail: { to: 'recert@tolokarooo.resend.app' } };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the address is not on the reserved .invalid TLD'));
});

// ── the phone app resolves the recertification send address (default) ──

test('the phone app resolves the recertification send address defaults when no address was already configured', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'the phone app resolves the recertification send address');
  assert.equal(ctx.configuredAddress, 'recert@tolokarooo.resend.app');
});

test('the phone app resolves the recertification send address preserves an already-configured address', () => {
  const registry = freshRegistry();
  const ctx = { configuredAddress: 'recert@inbound.musicalsifu.com' };
  resolveAndRun(registry, ctx, 'the phone app resolves the recertification send address');
  assert.equal(ctx.configuredAddress, 'recert@inbound.musicalsifu.com');
});
