'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/providerObservabilityParitySteps');

// BL-208 hardening: matching the established convention (see
// providerErrorTaxonomySteps.test.js/webhookSecretFixtureSteps.test.js/etc.)
// - the 3/3 Gherkin scenario run only exercises the happy path, so a
// regression in an assertion step's own failure branch would pass the
// feature run and go unnoticed. This file closes that gap.

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

// ── each provider's records carry the same core field keys with the same shapes ──

test('each provider carries the same field keys fails loudly when the shapes diverge', () => {
  const registry = freshRegistry();
  const ctx = {
    providers: ['claude', 'aider'],
    byProvider: {
      claude: { chases: 0, nudges: 0, deadLetters: 0, respawns: 0, recentDailyRate: 0 },
      aider: { chases: 0 }, // missing fields - a divergent shape
    },
  };
  assert.throws(
    () => resolveAndRun(registry, ctx, "each provider's records carry the same core field keys with the same shapes"),
    /expected every provider's record to share the same field keys/
  );
});

test('each provider carries the same field keys fails loudly when the shared shape omits an expected field', () => {
  const registry = freshRegistry();
  const ctx = {
    providers: ['claude', 'aider'],
    byProvider: {
      // Identical to each other, so the "do they match" check passes, but
      // both are missing `respawns` - the expected-shape check must still
      // catch it.
      claude: { chases: 0, nudges: 0, deadLetters: 0, recentDailyRate: 0 },
      aider: { chases: 0, nudges: 0, deadLetters: 0, recentDailyRate: 0 },
    },
  };
  assert.throws(
    () => resolveAndRun(registry, ctx, "each provider's records carry the same core field keys with the same shapes"),
    /expected the common field shape/
  );
});

test("each provider's records carry the same core field keys passes for two real, freshly-seeded providers", () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'at least two different providers are active');
  resolveAndRun(registry, ctx, 'their telemetry is recorded');
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, "each provider's records carry the same core field keys with the same shapes")
  );
});

// ── it compares providers using the common fields, with no per-brand branch ──

test('it compares providers using the common fields fails loudly when the aggregation is wrong', () => {
  const registry = freshRegistry();
  const ctx = {
    byProvider: {
      claude: { chases: 0, nudges: 0 },
      aider: { chases: 1 },
    },
  };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it compares providers using the common fields, with no per-brand branch'),
    /expected coder's chase and cleaner's nudge to both land under "claude"/
  );
});

test('it compares providers using the common fields fails loudly when the second provider bucket is wrong', () => {
  const registry = freshRegistry();
  const ctx = {
    byProvider: {
      claude: { chases: 1, nudges: 1 },
      aider: { chases: 0 },
    },
  };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it compares providers using the common fields, with no per-brand branch'),
    /expected architect's chase to land under "aider"/
  );
});

test('it compares providers using the common fields passes when the real aggregation is exercised end to end', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'telemetry from multiple providers');
  resolveAndRun(registry, ctx, 'a metrics or operator reader aggregates it');
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'it compares providers using the common fields, with no per-brand branch')
  );
});

// ── its metrics read as zero or empty without error ─────────────────────

test('its metrics read as zero or empty fails loudly when the provider bucket is not all-zero', () => {
  const registry = freshRegistry();
  const ctx = {
    provider: 'codex',
    byProvider: { codex: { chases: 1, nudges: 0, deadLetters: 0, respawns: 0, recentDailyRate: 0 } },
    byRole: { 'some-role': { chases: 0, nudges: 0, deadLetters: 0, respawns: 0, recentDailyRate: 0 } },
  };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'its metrics read as zero or empty without error'),
    /expected an all-zero bucket for an untouched provider/
  );
});

test('its metrics read as zero or empty fails loudly when computeChaserTelemetry disagrees on the shape', () => {
  const registry = freshRegistry();
  const ctx = {
    provider: 'codex',
    byProvider: { codex: { chases: 0, nudges: 0, deadLetters: 0, respawns: 0, recentDailyRate: 0 } },
    byRole: { 'some-role': { chases: 1, nudges: 0, deadLetters: 0, respawns: 0, recentDailyRate: 0 } },
  };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'its metrics read as zero or empty without error'),
    /expected computeChaserTelemetry to agree on the same all-zero shape/
  );
});

test('its metrics read as zero or empty without error passes end to end for a never-seen provider', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'a provider that has emitted no telemetry yet');
  resolveAndRun(registry, ctx, 'the observability surface is queried');
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'its metrics read as zero or empty without error'));
});
