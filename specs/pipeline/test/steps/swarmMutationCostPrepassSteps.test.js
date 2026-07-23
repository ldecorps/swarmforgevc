'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/swarmMutationCostPrepassSteps');

// BL-224 hardening: matching the established convention (see
// gherkinMutationSteps.test.js/recertAddressSteps.test.js/etc.) - the 3/3
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

function mkTmpDirWithFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-swarm-prepass-test-'));
  fs.mkdirSync(path.join(dir, 'backlog', 'paused'), { recursive: true });
  if (name) {
    fs.writeFileSync(path.join(dir, 'backlog', 'paused', name), '');
  }
  return dir;
}

// ── no file named "*.yaml" is created in backlog/paused/ ────────────────

test('no file named "*.yaml" is created fails loudly when it was', () => {
  const registry = freshRegistry();
  const ctx = { fixtureRoot: mkTmpDirWithFile('*.yaml') };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'no file named "*.yaml" is created in backlog/paused/'),
    /expected no file literally named "\*\.yaml"/
  );
});

test('no file named "*.yaml" is created passes when nothing was created', () => {
  const registry = freshRegistry();
  const ctx = { fixtureRoot: mkTmpDirWithFile() };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'no file named "*.yaml" is created in backlog/paused/'));
});

// ── the launcher proceeds without a "No such file or directory" error on stderr ──

test('the launcher proceeds without glob noise fails loudly when stderr has the glob-not-found line', () => {
  const registry = freshRegistry();
  const ctx = { stderr: 'grep: .../backlog/paused/*.yaml: No such file or directory', stdout: 'swarmforge.sh invoked with:' };
  assert.throws(
    () =>
      resolveAndRun(registry, ctx, 'the launcher proceeds without a "No such file or directory" error on stderr'),
    /expected no glob-not-found noise on stderr/
  );
});

test('the launcher proceeds without glob noise fails loudly when swarmforge.sh was never reached', () => {
  const registry = freshRegistry();
  const ctx = { stderr: '', stdout: 'nothing relevant here' };
  assert.throws(
    () =>
      resolveAndRun(registry, ctx, 'the launcher proceeds without a "No such file or directory" error on stderr'),
    /expected the launcher to still reach and exec swarmforge\.sh/
  );
});

test('the launcher proceeds without glob noise passes on a clean run that reached swarmforge.sh', () => {
  const registry = freshRegistry();
  const ctx = { stderr: '', stdout: 'swarmforge.sh invoked with: ' };
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'the launcher proceeds without a "No such file or directory" error on stderr')
  );
});

// ── that item gains a "mutation_cost:" field ─────────────────────────────

test('that item gains a mutation_cost field fails loudly when it did not', () => {
  const registry = freshRegistry();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-swarm-prepass-test-'));
  fs.mkdirSync(path.join(dir, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'backlog', 'paused', 'BL-9099.yaml'), 'id: BL-9099\n');
  const ctx = { fixtureRoot: dir };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'that item gains a "mutation_cost:" field'),
    /expected the item to gain a mutation_cost field/
  );
});

test('that item gains a mutation_cost field passes when it did', () => {
  const registry = freshRegistry();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-swarm-prepass-test-'));
  fs.mkdirSync(path.join(dir, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'backlog', 'paused', 'BL-9099.yaml'), 'id: BL-9099\nmutation_cost: low\n');
  const ctx = { fixtureRoot: dir };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'that item gains a "mutation_cost:" field'));
});

// ── that item is left byte-for-byte unchanged ───────────────────────────

test('that item is left byte-for-byte unchanged fails loudly when the content changed', () => {
  const registry = freshRegistry();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-swarm-prepass-test-'));
  fs.mkdirSync(path.join(dir, 'backlog', 'paused'), { recursive: true });
  const itemPath = path.join(dir, 'backlog', 'paused', 'BL-9099.yaml');
  fs.writeFileSync(itemPath, 'id: BL-9099\nmutation_cost: high\n');
  const ctx = { fixtureRoot: dir, shaBefore: 'not-the-real-hash' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'that item is left byte-for-byte unchanged'),
    /expected the item to be byte-for-byte unchanged/
  );
});

test('that item is left byte-for-byte unchanged passes when the hash matches', () => {
  const registry = freshRegistry();
  // The Given step itself creates the fixture root and records shaBefore -
  // no need to pre-create one; it deliberately never touches the file
  // afterward, so the hash should still match.
  const ctx = {};
  resolveAndRun(
    registry,
    ctx,
    'backlog/paused/ contains a ".yaml" item that already has a "mutation_cost:" field'
  );
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'that item is left byte-for-byte unchanged'));
});
