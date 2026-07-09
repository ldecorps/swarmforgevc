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
