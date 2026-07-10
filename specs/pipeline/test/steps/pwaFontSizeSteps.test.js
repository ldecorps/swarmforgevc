'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/pwaFontSizeSteps');

// BL-220 hardening: matching the established convention (see
// pwaLabelCatalogSteps.test.js/readyForNextPromotionSteps.test.js/etc.) -
// the 6/6 Gherkin scenario run only exercises the happy path, so a
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

// ── Background: rem-sizing premise ───────────────────────────────────────

test('the Background rem-sizing check fails loudly when a view selector uses a fixed px size', () => {
  const registry = freshRegistry();
  const ctx = { html: '<style>h2 { font-size: 16px; } h3, h4 { font-size: 0.85rem; } ul { font-size: 0.85rem; } .doc-content { font-size: 0.85rem; } .gherkin { font-size: 0.8rem; }</style>' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the PWA phone app, whose views all size in rem from the root font-size'),
    /expected these view selectors to size in rem: h2 \{/
  );
});

test('the Background rem-sizing check fails loudly when a view selector is missing entirely', () => {
  const registry = freshRegistry();
  const ctx = { html: '<style>h3, h4 { font-size: 0.85rem; } ul { font-size: 0.85rem; } .doc-content { font-size: 0.85rem; } .gherkin { font-size: 0.8rem; }</style>' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the PWA phone app, whose views all size in rem from the root font-size'),
    /expected these view selectors to size in rem: h2 \{/
  );
});

test('the Background rem-sizing check passes when every view selector sizes in rem', () => {
  const registry = freshRegistry();
  const ctx = {
    html: '<style>h2 { font-size: 0.95rem; } h3, h4, h5 { font-size: 0.85rem; } ul { font-size: 0.85rem; } .doc-content { font-size: 0.85rem; } .gherkin { font-size: 0.8rem; }</style>',
  };
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'the PWA phone app, whose views all size in rem from the root font-size')
  );
});

test('the Background rem-sizing check passes end to end against the real pwa/index.html', () => {
  const registry = freshRegistry();
  assert.doesNotThrow(() =>
    resolveAndRun(registry, {}, 'the PWA phone app, whose views all size in rem from the root font-size')
  );
});

// ── the root font-size is 28px ───────────────────────────────────────────

test('the root font-size is 28px fails loudly when the result differs from the default', () => {
  const registry = freshRegistry();
  const ctx = { result: { fontSizePx: 30 } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the root font-size is 28px'),
    /expected the default root font-size to be 28px/
  );
});

test('default-large-01 passes end to end through the real render harness', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'no font-size preference has ever been saved');
  resolveAndRun(registry, ctx, 'the page loads');
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the root font-size is 28px'));
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'every view scales up from that root together'));
});

// ── the root font-size <direction> by one 2px step ───────────────────────

test('the root font-size grows/shrinks check fails loudly on the wrong value', () => {
  const registry = freshRegistry();
  const ctx = { control: 'A+', result: { fontSizePx: 28 } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the root font-size grows by one 2px step'),
    /expected the root font-size to be 30px after one A\+ tap/
  );
});

test('the root font-size grows/shrinks check passes for the shrink direction', () => {
  const registry = freshRegistry();
  const ctx = { control: 'A-', result: { fontSizePx: 26 } };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the root font-size shrinks by one 2px step'));
});

test('the new size applies immediately check fails loudly when there is no definite reading', () => {
  const registry = freshRegistry();
  const ctx = { result: {} };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the new size applies immediately with no reload'),
    /expected a definite font-size reading/
  );
});

test('step-02 passes end to end for both control directions', () => {
  for (const [control, direction, expected] of [
    ['A+', 'grows', 30],
    ['A-', 'shrinks', 26],
  ]) {
    const registry = freshRegistry();
    const ctx = {};
    resolveAndRun(registry, ctx, 'the app is showing the default font size');
    resolveAndRun(registry, ctx, `the operator activates the "${control}" control`);
    assert.equal(ctx.result.fontSizePx, expected);
    assert.doesNotThrow(() => resolveAndRun(registry, ctx, `the root font-size ${direction} by one 2px step`));
    assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the new size applies immediately with no reload'));
  }
});

// ── the root font-size never passes <limit> ──────────────────────────────

test('the never-passes-limit check fails loudly when the value exceeds the limit', () => {
  const registry = freshRegistry();
  const ctx = { result: { fontSizePx: 42 } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the root font-size never passes 40px'),
    /expected the clamped font-size to be exactly 40px/
  );
});

test('clamp-03 passes end to end for both bounds', () => {
  for (const [bound, control, limit] of [
    ['maximum', 'A+', 40],
    ['minimum', 'A-', 16],
  ]) {
    const registry = freshRegistry();
    const ctx = {};
    resolveAndRun(registry, ctx, `the root font-size is already at its ${bound}`);
    resolveAndRun(registry, ctx, `the operator activates the "${control}" control repeatedly`);
    assert.doesNotThrow(() => resolveAndRun(registry, ctx, `the root font-size never passes ${limit}px`));
  }
});

// ── the page loads at the previously chosen size, not the default ───────

test('the reopen-preserves-size check fails loudly when the setup never left the default', () => {
  const registry = freshRegistry();
  const ctx = { result: { beforePx: 28, reopenPx: 28 } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the page loads at the previously chosen size, not the default'),
    /setup sanity: expected the chosen size to be non-default/
  );
});

test('the reopen-preserves-size check fails loudly when the reopened size drifts from the chosen one', () => {
  const registry = freshRegistry();
  const ctx = { result: { beforePx: 34, reopenPx: 28 } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the page loads at the previously chosen size, not the default'),
    /expected the reopened size \(28px\) to match the previously chosen size \(34px\)/
  );
});

test('persist-04 passes end to end through the real render harness', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'the operator has changed the font size to a non-default value');
  resolveAndRun(registry, ctx, 'the app is closed and reopened');
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'the page loads at the previously chosen size, not the default')
  );
});
