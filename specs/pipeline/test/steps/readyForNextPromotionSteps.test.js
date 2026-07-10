'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/readyForNextPromotionSteps');

// BL-226 hardening: matching the established convention (see
// pwaLabelCatalogSteps.test.js/providerObservabilityParitySteps.test.js/etc.)
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

// ── it execs "<helper>" as before ────────────────────────────────────────

test('it execs as before fails loudly when the output does not match the helper marker', () => {
  const registry = freshRegistry();
  const ctx = { output: 'NO_TASK\n' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it execs "ready_for_next_task.sh" as before'),
    /expected output matching.*routed to ready_for_next_task\.sh/
  );
});

test('it execs as before rejects an unknown helper name outright', () => {
  const registry = freshRegistry();
  const ctx = { output: 'TASK: something\n' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it execs "some_other_helper.sh" as before'),
    /unknown helper "some_other_helper\.sh"/
  );
});

test('it execs as before passes when the batch marker is present', () => {
  const registry = freshRegistry();
  const ctx = { output: 'BATCH: /tmp/foo\nCOUNT: 1\n' };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'it execs "ready_for_next_batch.sh" as before'));
});

test('dispatch-unchanged-01 passes end to end for both task and batch modes', () => {
  for (const [mode, helper] of [
    ['task', 'ready_for_next_task.sh'],
    ['batch', 'ready_for_next_batch.sh'],
  ]) {
    const registry = freshRegistry();
    const ctx = {};
    resolveAndRun(registry, ctx, `a role whose receive mode is "${mode}"`);
    resolveAndRun(registry, ctx, 'ready_for_next runs');
    assert.doesNotThrow(() => resolveAndRun(registry, ctx, `it execs "${helper}" as before`));
  }
});

// ── no item is moved from backlog/paused/ to backlog/active/ ─────────────

test('no item is moved fails loudly when the paused item vanished from backlog/paused/', () => {
  const registry = freshRegistry();
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-ready-for-next-fail-test-'));
  fs.mkdirSync(path.join(worktree, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(path.join(worktree, 'backlog', 'active'), { recursive: true });
  const ctx = { worktree };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'no item is moved from backlog/paused/ to backlog/active/ by the helper'),
    /expected the paused item to still be in backlog\/paused\//
  );
});

test('no item is moved fails loudly when the item appears in backlog/active/', () => {
  const registry = freshRegistry();
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-ready-for-next-fail-test-'));
  fs.mkdirSync(path.join(worktree, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(path.join(worktree, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(worktree, 'backlog', 'paused', 'BL-9001-demo.yaml'), 'id: BL-9001\n');
  fs.writeFileSync(path.join(worktree, 'backlog', 'active', 'BL-9001-demo.yaml'), 'id: BL-9001\n');
  const ctx = { worktree };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'no item is moved from backlog/paused/ to backlog/active/ by the helper'),
    /expected no item promoted into backlog\/active\//
  );
});

test('no-helper-promotion-02 passes end to end through the real ready_for_next.bb', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'a paused backlog item with backlog/active/ below the depth cap');
  resolveAndRun(registry, ctx, 'ready_for_next runs');
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'no item is moved from backlog/paused/ to backlog/active/ by the helper')
  );
});
