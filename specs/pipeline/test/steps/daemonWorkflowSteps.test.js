'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/daemonWorkflowSteps');

// BL-203 hardening: daemonWorkflowSteps.js had no sibling unit test file,
// unlike backlogSteps.js (specs/pipeline/test/steps/backlogSteps.test.js),
// which tests its shared assertion helpers on both the happy path AND the
// failure path (naming the mismatch). The 4/4 Gherkin scenario run only
// exercises happy paths - a regression in a guard's failure branch (wrong
// launch config silently accepted, a missing handoff silently treated as
// delivered, an unstopped daemon reported as stopped) would pass the
// feature run and go unnoticed. This file closes that gap for the same
// core assertion helpers, matching the established convention.

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

// ── the operator launches "..." (ac-01 launch-config guard) ─────────────

test('the operator launches step accepts the real two-pack stabilize launch config name', () => {
  const registry = freshRegistry();
  const ctx = {};
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the operator launches "Run Extension (two-pack stabilize · daemon on)"'));
});

test('the operator launches step rejects a launch config name that is not the two-pack stabilize config', () => {
  const registry = freshRegistry();
  const ctx = {};
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the operator launches "Run Extension (seven-pack)"'),
    /unexpected launch config "Run Extension \(seven-pack\)"/
  );
});

// ── coder/cleaner/coordinator receive the parcel (ac-03 assertRoleReceivedTask) ──

test('coder receives the parcel via handoffd fails loudly, naming the role and ticket, when no matching handoff was delivered', () => {
  const registry = freshRegistry();
  const ctx = {};
  // "BL-203 is active" promotes the Background's paused fixture into
  // active/, so the Background step must run first. Deliberately skip "the
  // coordinator routes work to coder", which is what would normally write
  // the fixture handoff this assertion looks for.
  resolveAndRun(registry, ctx, 'BL-203 is the only paused ticket (queue isolated)');
  resolveAndRun(registry, ctx, 'BL-203 is active');
  assert.throws(
    () => resolveAndRun(registry, ctx, 'coder receives the parcel via handoffd'),
    /expected coder's completed inbox .* to contain a handoff for BL-203, found: \(none\)/
  );
});

test('coder receives the parcel via handoffd passes once the coordinator has routed work to coder', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'BL-203 is the only paused ticket (queue isolated)');
  resolveAndRun(registry, ctx, 'BL-203 is active');
  resolveAndRun(registry, ctx, 'the coordinator routes work to coder');
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'coder receives the parcel via handoffd'));
});

// ── all tmux sessions and handoffd processes stop (ac-04 stop guard) ────

test('all tmux sessions and handoffd processes stop fails when the first stop did not succeed', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'aps-daemon-workflow-test-')) };
  fs.mkdirSync(path.join(ctx.targetPath, '.swarmforge'), { recursive: true });
  ctx.firstStopResult = { success: false, message: 'handoffd refused to terminate' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'all tmux sessions and handoffd processes stop'),
    /expected the first stop to succeed: handoffd refused to terminate/
  );
});

// ── .swarmforge/tmux-socket is cleared (ac-04 socket guard) ─────────────

test('.swarmforge/tmux-socket is cleared fails when the socket file is still present', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'aps-daemon-workflow-test-')) };
  const swarmforgeDir = path.join(ctx.targetPath, '.swarmforge');
  fs.mkdirSync(swarmforgeDir, { recursive: true });
  fs.writeFileSync(path.join(swarmforgeDir, 'tmux-socket'), path.join(ctx.targetPath, 'fake.sock'));
  assert.throws(
    () => resolveAndRun(registry, ctx, '.swarmforge/tmux-socket is cleared'),
    /expected \.swarmforge\/tmux-socket to be cleared/
  );
});

test('.swarmforge/tmux-socket is cleared passes once the socket file is gone', () => {
  const registry = freshRegistry();
  const ctx = { targetPath: fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'aps-daemon-workflow-test-')) };
  fs.mkdirSync(path.join(ctx.targetPath, '.swarmforge'), { recursive: true });
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, '.swarmforge/tmux-socket is cleared'));
});
