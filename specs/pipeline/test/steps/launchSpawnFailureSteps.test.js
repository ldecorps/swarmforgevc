'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/launchSpawnFailureSteps');

// BL-219 hardening: matching the established convention (see
// daemonWorkflowSteps.test.js) - the 2/2 Gherkin scenario run only
// exercises the happy path (launchSwarm DOES fail as expected), so a
// regression in either Then-step's own failure branch (a real launchSwarm
// success wrongly accepted as a spawn failure) would pass the feature run
// and go unnoticed. This file closes that gap for both Then-step guards.

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

// ── it resolves failure with a "..." message ────────────────────────────

test('it resolves failure with a "..." message fails loudly when launchSwarm actually succeeded', () => {
  const registry = freshRegistry();
  const ctx = { result: { success: true, message: 'SwarmForge launched successfully.' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it resolves failure with a "Failed to start swarm" message'),
    /expected launchSwarm to resolve failure/
  );
});

test('it resolves failure with a "..." message fails loudly when the message does not include the expected text', () => {
  const registry = freshRegistry();
  const ctx = { result: { success: false, message: 'boom, unrelated failure' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it resolves failure with a "Failed to start swarm" message'),
    /expected result\.message to include "Failed to start swarm"/
  );
});

test('it resolves failure with a "..." message passes when the failure message matches', () => {
  const registry = freshRegistry();
  const ctx = { result: { success: false, message: 'Failed to start swarm: spawn ENOENT' } };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'it resolves failure with a "Failed to start swarm" message'));
});

// ── launchSwarm still observes the spawn failure ────────────────────────

test('launchSwarm still observes the spawn failure fails loudly when launchSwarm actually succeeded', () => {
  const registry = freshRegistry();
  const ctx = { result: { success: true, message: 'SwarmForge launched successfully.' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'launchSwarm still observes the spawn failure'),
    /expected launchSwarm to still observe the spawn failure/
  );
});

test('launchSwarm still observes the spawn failure passes once the result reports failure', () => {
  const registry = freshRegistry();
  const ctx = { result: { success: false, message: 'Failed to start swarm: spawn ENOENT' } };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'launchSwarm still observes the spawn failure'));
});
