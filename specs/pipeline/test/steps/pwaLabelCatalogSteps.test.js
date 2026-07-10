'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/pwaLabelCatalogSteps');

// BL-229 hardening: matching the established convention (see
// recertAddressSteps.test.js/providerObservabilityParitySteps.test.js/etc.)
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

// ── the remaining-count label shows its French catalog value ────────────

test('the remaining-count label check fails loudly when the French value is missing', () => {
  const registry = freshRegistry();
  const ctx = { rendered: { burndownText: 'M4: 2 remaining' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the remaining-count label shows its French catalog value, not the English word "remaining"'),
    /expected the French catalog value "restants"/
  );
});

test('the remaining-count label check fails loudly when the English word survives alongside the French value', () => {
  const registry = freshRegistry();
  const ctx = { rendered: { burndownText: 'M4: 2 restants (2 remaining)' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the remaining-count label shows its French catalog value, not the English word "remaining"'),
    /expected the English word "remaining" to be gone/
  );
});

test('the remaining-count label check passes when only the French value is present', () => {
  const registry = freshRegistry();
  const ctx = { rendered: { burndownText: 'M4: 2 restants' } };
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'the remaining-count label shows its French catalog value, not the English word "remaining"')
  );
});

test('label-catalog-01 passes end to end through the real render harness', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'the PWA in French');
  resolveAndRun(registry, ctx, 'the burndown is rendered');
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'the remaining-count label shows its French catalog value, not the English word "remaining"')
  );
});

// ── the ETA label is a catalog lookup, jargon value allowed ─────────────

test('the ETA label check fails loudly when the ETA label is missing entirely', () => {
  const registry = freshRegistry();
  const ctx = { rendered: { boardText: 'BL-100 — x' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the ETA label is a catalog lookup, whose French value may remain "ETA" as jargon'),
    /expected a catalog-sourced ETA label/
  );
});

test('the ETA label check passes when the jargon ETA value is present', () => {
  const registry = freshRegistry();
  const ctx = { rendered: { boardText: 'BL-100 — x — ETA 2026-08-01' } };
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'the ETA label is a catalog lookup, whose French value may remain "ETA" as jargon')
  );
});

test('label-catalog-02 passes end to end through the real render harness', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'the PWA in French');
  resolveAndRun(registry, ctx, 'a ticket ETA is rendered');
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'the ETA label is a catalog lookup, whose French value may remain "ETA" as jargon')
  );
});

// ── every such label is a tr(...) catalog lookup, not an inline literal ──

test('the no-hardcoded audit fails loudly when the ETA literal is still inline', () => {
  const registry = freshRegistry();
  const ctx = { appSource: "var eta = t.p50Iso ? ' — ETA ' + t.p50Iso.slice(0, 10) : '';\ntr('remainingSuffix')" };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'every such label is a tr(...) catalog lookup, not an inline English string literal'),
    /found an inline " — ETA " literal/
  );
});

test('the no-hardcoded audit fails loudly when the remaining literal is still inline', () => {
  const registry = freshRegistry();
  const ctx = { appSource: "tr('etaPrefix')\ncontainer.appendChild(el('h4', {}, [m.milestone + ': ' + m.currentRemaining + ' remaining']));" };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'every such label is a tr(...) catalog lookup, not an inline English string literal'),
    /found an inline " remaining" literal/
  );
});

test('the no-hardcoded audit fails loudly when neither catalog lookup is present at all', () => {
  const registry = freshRegistry();
  const ctx = { appSource: 'no labels here' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'every such label is a tr(...) catalog lookup, not an inline English string literal'),
    /expected both etaPrefix and remainingSuffix catalog lookups to be present/
  );
});

test('no-hardcoded-03 passes end to end against the real pwa/app.js source', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'the PWA render functions');
  resolveAndRun(registry, ctx, 'they build user-visible label text');
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'every such label is a tr(...) catalog lookup, not an inline English string literal')
  );
});
