'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/mailboxIntakeSteps');

// BL-218 hardening: matching the established convention (see
// daemonWorkflowSteps.test.js/launchSpawnFailureSteps.test.js) - the 4/4
// Gherkin scenario run only exercises the happy path (the guard correctly
// resolves), so a regression in an assertion step's own failure branch (a
// resurrected handoff wrongly accepted as "not promoted") would pass the
// feature run and go unnoticed. This file closes that gap for each
// Then-step's failure branch.

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mailbox-intake-test-'));
}

// ── the stale copy is not promoted to in_process/ ───────────────────────

test('the stale copy is not promoted to in_process/ fails loudly when it actually was', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp() };
  const inProcess = path.join(ctx.targetPath, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(inProcess, { recursive: true });
  fs.writeFileSync(path.join(inProcess, '50_stale.handoff'), 'resurrected');
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the stale copy is not promoted to in_process/'),
    /expected the stale copy not to be promoted/
  );
});

test('the stale copy is not promoted to in_process/ passes when in_process/ is empty', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp() };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the stale copy is not promoted to in_process/'));
});

// ── it is skipped with a logged "already-processed" line ────────────────

test('it is skipped with a logged "already-processed" line fails when no such line was printed', () => {
  const registry = freshRegistry();
  const ctx = { output: 'NO_TASK\n' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it is skipped with a logged "already-processed" line'),
    /expected an "already-processed" skip line/
  );
});

test('it is skipped with a logged "already-processed" line passes when the line is present', () => {
  const registry = freshRegistry();
  const ctx = { output: 'SKIPPED already-processed: 50_stale.handoff\nNO_TASK\n' };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'it is skipped with a logged "already-processed" line'));
});

// ── it is promoted to in_process/ with a fresh dequeued_at ──────────────

test('it is promoted to in_process/ with a fresh dequeued_at fails when the file was never promoted', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp(), output: 'NO_TASK\n' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it is promoted to in_process/ with a fresh dequeued_at'),
    /expected 50_fresh\.handoff to be promoted/
  );
});

test('it is promoted to in_process/ with a fresh dequeued_at fails when the header is missing', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp() };
  const inProcess = path.join(ctx.targetPath, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(inProcess, { recursive: true });
  fs.writeFileSync(path.join(inProcess, '50_fresh.handoff'), 'task: BL-218-test\n\nno dequeued_at here\n');
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it is promoted to in_process/ with a fresh dequeued_at'),
    /expected a fresh dequeued_at header/
  );
});

test('it is promoted to in_process/ with a fresh dequeued_at passes once both hold', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp() };
  const inProcess = path.join(ctx.targetPath, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(inProcess, { recursive: true });
  fs.writeFileSync(path.join(inProcess, '50_fresh.handoff'), 'task: BL-218-test\ndequeued_at: 2026-07-10T00:00:00Z\n\nbody\n');
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'it is promoted to in_process/ with a fresh dequeued_at'));
});

// ── the completed handoff is not re-promoted to in_process/ ─────────────

test('the completed handoff is not re-promoted to in_process/ fails loudly when it actually was', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp() };
  const inProcess = path.join(ctx.targetPath, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(inProcess, { recursive: true });
  fs.writeFileSync(path.join(inProcess, '50_flat-stale.handoff'), 'resurrected');
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the completed handoff is not re-promoted to in_process/'),
    /expected the flat-layout completed handoff not to be re-promoted/
  );
});

test('the completed handoff is not re-promoted to in_process/ passes when in_process/ is empty', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: mkTmp() };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the completed handoff is not re-promoted to in_process/'));
});
