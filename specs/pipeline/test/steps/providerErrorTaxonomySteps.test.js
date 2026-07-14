'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/providerErrorTaxonomySteps');

// BL-207 hardening: matching the established convention (see
// webhookSecretFixtureSteps.test.js/recertAddressSteps.test.js/etc.) - the
// 3/3 Gherkin scenario run only exercises the happy path, so a regression
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

// ── it is reported as one of the enumerated Forge error categories ─────

test('it is reported as one of the enumerated Forge error categories fails loudly on an unenumerated category', () => {
  const registry = freshRegistry();
  const ctx = { tsResult: { category: 'not-a-real-category' }, bbResult: { category: 'not-a-real-category' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it is reported as one of the enumerated Forge error categories'),
    /expected an enumerated category/
  );
});

test('it is reported as one of the enumerated Forge error categories fails loudly when ts/bb disagree', () => {
  const registry = freshRegistry();
  const ctx = { tsResult: { category: 'auth' }, bbResult: { category: 'unavailable' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it is reported as one of the enumerated Forge error categories'),
    /expected the TS and bb classifiers to agree/
  );
});

test('it is reported as one of the enumerated Forge error categories passes when both agree on an enumerated category', () => {
  const registry = freshRegistry();
  const ctx = { tsResult: { category: 'auth' }, bbResult: { category: 'auth' } };
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'it is reported as one of the enumerated Forge error categories')
  );
});

// ── the original backend detail is attached as context ──────────────────

test('the original backend detail is attached as context fails loudly when the detail was altered', () => {
  const registry = freshRegistry();
  const ctx = { detail: 'original text', tsResult: { detail: 'altered' }, bbResult: { detail: 'original text' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the original backend detail is attached as context'),
    /expected the original detail attached unchanged/
  );
});

test('the original backend detail is attached as context passes when both preserve it', () => {
  const registry = freshRegistry();
  const ctx = { detail: 'original text', tsResult: { detail: 'original text' }, bbResult: { detail: 'original text' } };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the original backend detail is attached as context'));
});

// ── both map to the same Forge error category ───────────────────────────

test('both map to the same Forge error category fails loudly when one is not auth', () => {
  const registry = freshRegistry();
  const ctx = { resultA: { category: 'auth' }, resultB: { category: 'unavailable' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'both map to the same Forge error category'),
    /expected both auth failures to map to "auth"/
  );
});

test('both map to the same Forge error category passes when both are auth', () => {
  const registry = freshRegistry();
  const ctx = { resultA: { category: 'auth' }, resultB: { category: 'auth' } };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'both map to the same Forge error category'));
});

// ── it is categorized as "unknown" with its raw detail attached ────────

test('it is categorized as "unknown" fails loudly when a category is not unknown', () => {
  const registry = freshRegistry();
  const ctx = { detail: 'x', tsResult: { category: 'launch-failed', detail: 'x' }, bbResult: { category: 'unknown', detail: 'x' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it is categorized as "unknown" with its raw detail attached'),
    /expected "unknown"/
  );
});

test('it is categorized as "unknown" fails loudly when the detail was dropped', () => {
  const registry = freshRegistry();
  const ctx = { detail: 'x', tsResult: { category: 'unknown', detail: '' }, bbResult: { category: 'unknown', detail: 'x' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it is categorized as "unknown" with its raw detail attached'),
    /expected the raw detail to still be attached/
  );
});

test('it is categorized as "unknown" passes when both agree and preserve detail', () => {
  const registry = freshRegistry();
  const ctx = { detail: 'x', tsResult: { category: 'unknown', detail: 'x' }, bbResult: { category: 'unknown', detail: 'x' } };
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'it is categorized as "unknown" with its raw detail attached')
  );
});
