'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStepRegistry } = require('../stepRegistry');

test('resolve returns null when no pattern matches', () => {
  const registry = createStepRegistry();
  registry.define(/^a thing$/, () => {});
  assert.equal(registry.resolve('a different thing'), null);
});

test('resolve finds a handler whose pattern matches the full step text', () => {
  const registry = createStepRegistry();
  const handler = () => {};
  registry.define(/^a thing$/, handler);
  const resolved = registry.resolve('a thing');
  assert.equal(resolved.handler, handler);
  assert.deepEqual(resolved.args, []);
});

test('resolve captures regex groups as ordered args', () => {
  const registry = createStepRegistry();
  const handler = () => {};
  registry.define(/^a backlog item "([^"]+)" with status "([^"]+)"$/, handler);
  const resolved = registry.resolve('a backlog item "BL-1" with status "active"');
  assert.equal(resolved.handler, handler);
  assert.deepEqual(resolved.args, ['BL-1', 'active']);
});

test('resolve prefers the first defined pattern that matches', () => {
  const registry = createStepRegistry();
  const first = () => 'first';
  const second = () => 'second';
  registry.define(/^a (.+)$/, first);
  registry.define(/^a thing$/, second);
  assert.equal(registry.resolve('a thing').handler, first);
});

// BL-425: two DIFFERENT tickets' step files can legitimately register the
// exact same generic step text (e.g. "the message is handled") for
// completely unrelated behavior - a real collision hit while implementing
// BL-425 (serialiseBlTopicContentSteps.js already owned that literal text).
// defineScoped lets a step file pin its registration to its OWN feature's
// name, so it is only ever preferred when THAT feature is the one running -
// every pre-existing registry.define call stays fully unscoped and its
// first-match-wins behavior is completely unchanged (verified by the
// no-featureName-argument test below).
test('resolve prefers a scoped definition matching the current feature name over an earlier unscoped match', () => {
  const registry = createStepRegistry();
  const generic = () => 'generic';
  const scoped = () => 'scoped';
  registry.define(/^the message is handled$/, generic);
  registry.defineScoped(/^the message is handled$/, scoped, 'Feature B');
  assert.equal(registry.resolve('the message is handled', 'Feature B').handler, scoped);
});

test('resolve falls back to the ordinary first-match scan when no scoped definition matches the current feature name', () => {
  const registry = createStepRegistry();
  const generic = () => 'generic';
  const scopedElsewhere = () => 'scoped-elsewhere';
  registry.define(/^the message is handled$/, generic);
  registry.defineScoped(/^the message is handled$/, scopedElsewhere, 'Feature B');
  assert.equal(registry.resolve('the message is handled', 'Feature A').handler, generic);
});

test('resolve called with no featureName argument at all behaves exactly as before scoping existed', () => {
  const registry = createStepRegistry();
  const handler = () => {};
  registry.define(/^a thing$/, handler);
  assert.equal(registry.resolve('a thing').handler, handler);
});

test('a scoped definition never resolves for an unrelated feature name, even with no unscoped fallback registered at all', () => {
  const registry = createStepRegistry();
  registry.defineScoped(/^only for feature b$/, () => {}, 'Feature B');
  assert.equal(registry.resolve('only for feature b', 'Feature A'), null);
});
