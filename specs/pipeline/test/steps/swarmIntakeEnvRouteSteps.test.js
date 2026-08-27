'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/swarmIntakeEnvRouteSteps');

// BL-227 hardening: matching the established convention (see
// readyForNextPromotionSteps.test.js/pwaLabelCatalogSteps.test.js/etc.) -
// the 2/2 Gherkin scenario run only exercises the happy path, so a
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

// ── none contains a ${{ github.event... }} or ${{ steps... }} expression ─

test('none contains an interpolation expression fails loudly when a run: body still interpolates github.event', () => {
  const registry = freshRegistry();
  const ctx = { runBodies: [{ name: 'Commit', run: 'git commit -m "Intake GH-${{ github.event.issue.number }}"' }] };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'none contains a ${{ github.event... }} or ${{ steps... }} expression'),
    /found it in: Commit/
  );
});

test('none contains an interpolation expression fails loudly when a run: body interpolates a steps output', () => {
  const registry = freshRegistry();
  const ctx = { runBodies: [{ name: 'Notify', run: 'echo "${{ steps.build.outputs.sha }}"' }] };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'none contains a ${{ github.event... }} or ${{ steps... }} expression'),
    /found it in: Notify/
  );
});

test('none contains an interpolation expression passes when every run: body only reads plain shell variables', () => {
  const registry = freshRegistry();
  const ctx = { runBodies: [{ name: 'Commit', run: 'git commit -m "Intake GH-$NUM"' }] };
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'none contains a ${{ github.event... }} or ${{ steps... }} expression')
  );
});

test('no-run-interpolation-01 passes end to end against the real swarm-intake.yml', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'the swarm-intake workflow');
  resolveAndRun(registry, ctx, 'its run: script bodies are inspected');
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'none contains a ${{ github.event... }} or ${{ steps... }} expression')
  );
});

// ── the commit message still records the issue number and the issue URL ─

test('the commit message check fails loudly when NUM/URL are not bound via env:', () => {
  const registry = freshRegistry();
  const ctx = { commitStep: { env: {}, run: 'git commit -m "Intake GH-$NUM\n\nFrom issue: $URL"' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the commit message still records the issue number and the issue URL'),
    /expected the Commit step to bind NUM\/URL env: keys/
  );
});

test('the commit message check fails loudly when the run body no longer references $NUM/$URL', () => {
  const registry = freshRegistry();
  const ctx = {
    commitStep: {
      env: { NUM: '${{ github.event.issue.number }}', URL: '${{ github.event.issue.html_url }}' },
      run: 'git commit -m "Intake to backlog root"',
    },
  };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the commit message still records the issue number and the issue URL'),
    /expected the commit message body to reference \$NUM and \$URL/
  );
});

test('the commit message check fails loudly when the run body still interpolates github.event directly', () => {
  const registry = freshRegistry();
  const ctx = {
    commitStep: {
      env: { NUM: '${{ github.event.issue.number }}', URL: '${{ github.event.issue.html_url }}' },
      run: 'git commit -m "Intake GH-$NUM\n\nFrom issue: $URL, also ${{ github.event.issue.html_url }}"',
    },
  };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the commit message still records the issue number and the issue URL'),
    /expected the commit message to no longer interpolate/
  );
});

test('commit-message-preserved-02 passes end to end against the real swarm-intake.yml', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'an issue triggers the intake workflow');
  resolveAndRun(registry, ctx, 'the Commit step runs');
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'the commit message still records the issue number and the issue URL')
  );
});
