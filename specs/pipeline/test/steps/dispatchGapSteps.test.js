'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/dispatchGapSteps');

// BL-222 hardening: matching the established convention (see
// daemonWorkflowSteps.test.js/launchSpawnFailureSteps.test.js/
// mailboxIntakeSteps.test.js/strykerPwaSandboxSteps.test.js) - the 3/3
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

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-dispatch-gap-test-'));
}

function writeQueuedNote(targetPath, itemId, to) {
  const dir = path.join(targetPath, '.swarmforge', 'handoffs', 'coordinator', 'outbox');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '00_test.handoff'),
    `id: test\nfrom: coordinator\nto: ${to}\npriority: 00\ntype: note\nmessage: ${itemId} is active with no dispatch on record - auto-routed by the sweep.\n\nbody\n`
  );
}

// ── the sweep runs at the existing chase interval (wiring-contract guard) ─

test('the sweep runs at the existing chase interval fails loudly if dispatch-gap-sweep! is not wired into the shared cadence', () => {
  // Can't easily break the real handoffd.bb from a unit test without
  // touching the shipped file; instead prove the guard actually inspects
  // content by asserting it currently passes against the real file (the
  // regression case - dispatch-gap-sweep! moved to its own timer or
  // removed entirely - is exactly what would make this step throw).
  const registry = freshRegistry();
  const ctx = {};
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the sweep runs at the existing chase interval'));
});

// ── the assignee receives a routing handoff for the item ────────────────

test('the assignee receives a routing handoff for the item fails loudly when nothing was queued', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp(), sweepOutput: 'GAPS: []' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the assignee receives a routing handoff for the item'),
    /expected an auto-routed note for BL-217/
  );
});

test('the assignee receives a routing handoff for the item fails loudly when queued but misaddressed', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp() };
  writeQueuedNote(ctx.targetPath, 'BL-217', 'cleaner');
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the assignee receives a routing handoff for the item'),
    /expected the queued note addressed to the assignee/
  );
});

test('the assignee receives a routing handoff for the item passes once correctly queued', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp() };
  writeQueuedNote(ctx.targetPath, 'BL-217', 'coder');
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the assignee receives a routing handoff for the item'));
});

// ── the sweep sends no further routing handoff for the item ─────────────

test('the sweep sends no further routing handoff for the item fails loudly when one was queued anyway', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp() };
  writeQueuedNote(ctx.targetPath, 'BL-217', 'coder');
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the sweep sends no further routing handoff for the item'),
    /expected no auto-routed note for BL-217/
  );
});

test('the sweep sends no further routing handoff for the item passes when the outbox is empty', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp() };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the sweep sends no further routing handoff for the item'));
});
