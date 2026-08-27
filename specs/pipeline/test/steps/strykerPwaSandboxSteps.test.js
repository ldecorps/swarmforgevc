'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/strykerPwaSandboxSteps');

// BL-221 hardening: matching the established convention (see
// daemonWorkflowSteps.test.js/launchSpawnFailureSteps.test.js/
// mailboxIntakeSteps.test.js) - the 2/2 Gherkin scenario run only exercises
// the happy path, so a regression in an assertion step's own failure
// branch (a broken sandbox link wrongly accepted as resolved) would pass
// the feature run and go unnoticed. This file closes that gap.

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

// ── the dry run does not fail with ENOENT on any pwa/ path ──────────────

test('the dry run does not fail with ENOENT on any pwa/ path fails loudly when the resolved path is missing', () => {
  const registry = freshRegistry();
  const ctx = { resolvedPwaAssetPath: path.join(os.tmpdir(), 'does-not-exist', 'index.html') };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the dry run does not fail with ENOENT on any pwa/ path'),
    /expected .* to resolve without ENOENT/
  );
});

// ── the test passes inside the sandbox as it does in a normal run ───────

test('the test passes inside the sandbox as it does in a normal run fails when the content differs', () => {
  const registry = freshRegistry();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-stryker-pwa-step-'));
  const assetPath = path.join(tmp, 'index.html');
  fs.writeFileSync(assetPath, 'not the expected content');
  const ctx = { resolvedPwaAssetPath: assetPath };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the test passes inside the sandbox as it does in a normal run'),
    /expected the sandboxed read to see the same content/
  );
});

test('the test passes inside the sandbox as it does in a normal run passes once the content matches', () => {
  const registry = freshRegistry();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-stryker-pwa-step-'));
  const assetPath = path.join(tmp, 'index.html');
  fs.writeFileSync(assetPath, '<html></html>');
  const ctx = { resolvedPwaAssetPath: assetPath };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the test passes inside the sandbox as it does in a normal run'));
});

// ── the run reaches mutant evaluation rather than aborting in the dry run ─

test('the run reaches mutant evaluation rather than aborting in the dry run fails loudly when the sandbox link never resolved', () => {
  const registry = freshRegistry();
  const ctx = { resolvedMarkerPath: path.join(os.tmpdir(), 'does-not-exist', 'marker') };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the run reaches mutant evaluation rather than aborting in the dry run'),
    /expected the sandbox-shared pwa\/ link to resolve/
  );
});

test('the run reaches mutant evaluation rather than aborting in the dry run passes once the marker resolves', () => {
  const registry = freshRegistry();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-stryker-pwa-step-'));
  const markerPath = path.join(tmp, 'marker');
  fs.writeFileSync(markerPath, 'ok');
  const ctx = { resolvedMarkerPath: markerPath };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the run reaches mutant evaluation rather than aborting in the dry run'));
});
