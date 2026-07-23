'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/backlogDepthSteps');

// BL-216 hardening: matching the established convention (see
// daemonWorkflowSteps.test.js/launchSpawnFailureSteps.test.js/
// mailboxIntakeSteps.test.js/strykerPwaSandboxSteps.test.js/
// dispatchGapSteps.test.js) - the 6/6 Gherkin scenario run only exercises
// the happy path, so a regression in an assertion step's own failure
// branch would pass the feature run and go unnoticed.

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

// ── a depth-exceeded warning is/is not emitted ──────────────────────────

test('a depth-exceeded warning "is emitted" fails loudly when nothing was warned', () => {
  const registry = freshRegistry();
  const ctx = { handoffOutput: 'HANDOFF QUEUED (daemon backup will deliver):/some/path' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'a depth-exceeded warning is emitted'),
    /expected a depth-exceeded warning/
  );
});

test('a depth-exceeded warning "is not emitted" fails loudly when one was warned anyway', () => {
  const registry = freshRegistry();
  const ctx = { handoffOutput: 'WARNING: Active backlog depth exceeded (active=5, max=3). Coordinator should promote paused items.' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'a depth-exceeded warning is not emitted'),
    /expected no depth-exceeded warning/
  );
});

// ── the depth cap is treated as unlimited, not a mis-parsed cap of 1 ────

test('the depth cap is treated as unlimited fails loudly when the gate reports gated (false)', () => {
  const registry = freshRegistry();
  const ctx = { gateResult: 'false' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the depth cap is treated as unlimited, not a mis-parsed cap of 1'),
    /expected the depth gate to report unlimited/
  );
});

test('the depth cap is treated as unlimited passes when the gate reports true', () => {
  const registry = freshRegistry();
  const ctx = { gateResult: 'true' };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the depth cap is treated as unlimited, not a mis-parsed cap of 1'));
});

// ── its value comes from the tracked file, not the fallback default ────

test('its value comes from the tracked file fails loudly when the default leaked through', () => {
  const registry = freshRegistry();
  const ctx = { readMaxDepth: '5' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'its value comes from the tracked file, not the fallback default'),
    /expected the tracked cap \(3\)/
  );
});

// ── it does not crash / no spurious over-cap warning is emitted ────────

test('it does not crash fails loudly when the depth-check step never ran', () => {
  const registry = freshRegistry();
  const ctx = {};
  assert.throws(() => resolveAndRun(registry, ctx, 'it does not crash'), /expected the depth check step to have run/);
});

test('no spurious over-cap warning is emitted fails loudly when one was emitted anyway', () => {
  const registry = freshRegistry();
  const ctx = { depthCheckOutput: 'WARNING: Active backlog depth exceeded (active=7, max=5). Coordinator should promote paused items.' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'no spurious over-cap warning is emitted'),
    /expected no spurious over-cap warning/
  );
});

test('no spurious over-cap warning is emitted passes for clean output', () => {
  const registry = freshRegistry();
  const ctx = { depthCheckOutput: 'HANDOFF QUEUED (daemon backup will deliver):/some/path' };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'no spurious over-cap warning is emitted'));
});

// ── no .swarmforge/swarmforge.conf exists (guards the OLD wrong path) ──

test('no .swarmforge/swarmforge.conf exists fails loudly if that stale fixture path is ever (re)created', () => {
  const registry = freshRegistry();
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const ctx = { targetPath: fs.mkdtempSync(path.join(os.tmpdir(), 'aps-backlog-depth-guard-')) };
  fs.mkdirSync(path.join(ctx.targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(ctx.targetPath, '.swarmforge', 'swarmforge.conf'), 'config active_backlog_max_depth 1\n');
  assert.throws(
    () => resolveAndRun(registry, ctx, 'no .swarmforge/swarmforge.conf exists'),
    /expected no fixture \.swarmforge\/swarmforge\.conf/
  );
});
