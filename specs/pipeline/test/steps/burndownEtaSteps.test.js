'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/burndownEtaSteps');

// BL-228 hardening: matching the established convention (see
// pwaFontSizeSteps.test.js/complianceBatterySteps.test.js/etc.) - the 5/5
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

// ── that milestone shows its forecast ETA alongside its remaining count ──

test('the milestone-ETA assertion fails loudly when the PWA burndown is missing the ETA', () => {
  const registry = freshRegistry();
  const ctx = { pwaBurndownText: 'M4: 2 remaining — no ETA yet', cliBurndownLine: 'Burndown: M4 2 remaining (ETA 2026-08-01)' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'that milestone shows its forecast ETA alongside its remaining count'),
    /expected the PWA burndown to show the milestone ETA/
  );
});

test('the milestone-ETA assertion fails loudly when the CLI burndown line is missing the ETA', () => {
  const registry = freshRegistry();
  const ctx = { pwaBurndownText: 'M4: 2 remaining — ETA 2026-08-01', cliBurndownLine: 'Burndown: M4 2 remaining' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'that milestone shows its forecast ETA alongside its remaining count'),
    /expected the CLI burndown line to show the milestone ETA/
  );
});

test('milestone-eta-01 passes end to end through the real render + format functions', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'a burndown milestone with a forecast p50 date');
  resolveAndRun(registry, ctx, 'the burndown is rendered');
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'that milestone shows its forecast ETA alongside its remaining count')
  );
});

// ── an overall "all remaining work" ETA is shown ─────────────────────────

test('the overall-ETA assertion fails loudly when the PWA overall ETA is not the latest p50', () => {
  const registry = freshRegistry();
  const ctx = { pwaBurndownText: 'Overall ETA: 2026-08-01M4: ...', cliBurndownLine: 'Burndown: ... overall ETA 2026-09-15' };
  assert.throws(
    () =>
      resolveAndRun(
        registry,
        ctx,
        'an overall "all remaining work" ETA — the latest projected completion — is shown'
      ),
    /expected the PWA overall ETA to be the latest/
  );
});

test('the overall-ETA assertion fails loudly when the CLI overall ETA is not the latest p50', () => {
  const registry = freshRegistry();
  const ctx = { pwaBurndownText: 'Overall ETA: 2026-09-15M4: ...', cliBurndownLine: 'Burndown: ... overall ETA 2026-08-01' };
  assert.throws(
    () =>
      resolveAndRun(
        registry,
        ctx,
        'an overall "all remaining work" ETA — the latest projected completion — is shown'
      ),
    /expected the CLI overall ETA to be the latest/
  );
});

test('backlog-eta-02 passes end to end through the real render + format functions', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'open tickets across milestones with forecasts');
  resolveAndRun(registry, ctx, 'the burndown is rendered');
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'an overall "all remaining work" ETA — the latest projected completion — is shown')
  );
});

// ── that milestone shows a "no ETA yet" indication ───────────────────────

test('the no-ETA assertion fails loudly when the PWA burndown fabricates a date instead', () => {
  const registry = freshRegistry();
  const ctx = { pwaBurndownText: 'M4: 2 remaining — ETA 2026-08-01', cliBurndownLine: 'Burndown: M4 2 remaining (no ETA yet)' };
  assert.throws(
    () =>
      resolveAndRun(registry, ctx, 'that milestone shows a "no ETA yet" indication, never an infinite or fabricated date'),
    /expected the PWA burndown to show "no ETA yet"/
  );
});

test('the no-ETA assertion fails loudly when the CLI burndown line fabricates a date instead', () => {
  const registry = freshRegistry();
  const ctx = { pwaBurndownText: 'M4: 2 remaining — no ETA yet', cliBurndownLine: 'Burndown: M4 2 remaining (ETA 2026-08-01)' };
  assert.throws(
    () =>
      resolveAndRun(registry, ctx, 'that milestone shows a "no ETA yet" indication, never an infinite or fabricated date'),
    /expected the CLI burndown line to show "no ETA yet"/
  );
});

test('the no-ETA assertion fails loudly when an Infinity/NaN sneaks into either surface', () => {
  const registry = freshRegistry();
  const ctx = {
    pwaBurndownText: 'M4: 2 remaining — no ETA yet Infinity',
    cliBurndownLine: 'Burndown: M4 2 remaining (no ETA yet)',
  };
  assert.throws(
    () =>
      resolveAndRun(registry, ctx, 'that milestone shows a "no ETA yet" indication, never an infinite or fabricated date'),
    /expected no infinite\/fabricated date/
  );
});

test('no-eta-03 passes end to end through the real render + format functions', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'a burndown milestone whose forecast p50 is null for insufficient throughput or history');
  resolveAndRun(registry, ctx, 'the burndown is rendered');
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'that milestone shows a "no ETA yet" indication, never an infinite or fabricated date')
  );
});

// ── the milestone ETA is present (both-surfaces-04) ──────────────────────

test('the milestone-ETA-is-present assertion fails loudly on the PWA dashboard surface when absent', () => {
  const registry = freshRegistry();
  const ctx = { surface: 'PWA dashboard', pwaBurndownText: 'M4: 2 remaining — no ETA yet' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the milestone ETA is present'),
    /expected the PWA dashboard surface to show the milestone ETA/
  );
});

test('the milestone-ETA-is-present assertion fails loudly on the swarm-metrics CLI surface when absent', () => {
  const registry = freshRegistry();
  const ctx = { surface: 'swarm-metrics CLI', cliBurndownLine: 'Burndown: M4 2 remaining (no ETA yet)' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the milestone ETA is present'),
    /expected the swarm-metrics CLI surface to show the milestone ETA/
  );
});

test('the milestone-ETA-is-present assertion rejects an unknown surface outright', () => {
  const registry = freshRegistry();
  const ctx = { surface: 'carrier pigeon' };
  assert.throws(() => resolveAndRun(registry, ctx, 'the milestone ETA is present'), /unknown surface/);
});

test('both-surfaces-04 passes end to end for both surface values', () => {
  for (const surface of ['PWA dashboard', 'swarm-metrics CLI']) {
    const registry = freshRegistry();
    const ctx = {};
    resolveAndRun(registry, ctx, 'a burndown milestone with a forecast p50 date');
    resolveAndRun(registry, ctx, `the burndown is rendered on the ${surface}`);
    assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the milestone ETA is present'));
  }
});
