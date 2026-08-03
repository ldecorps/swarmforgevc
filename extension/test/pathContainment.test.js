const assert = require('node:assert/strict');
const path = require('node:path');
const { isPathInside } = require('../out/util/pathContainment');

test('reports true for a path equal to the root', () => {
  assert.equal(isPathInside('/a/b', '/a/b'), true);
});

test('reports true for a path nested several directories under the root', () => {
  assert.equal(isPathInside('/a/b/c/d', '/a/b'), true);
});

test('reports false for a sibling path that only shares a prefix', () => {
  assert.equal(isPathInside('/a/bee', '/a/b'), false);
});

test('reports false for a path outside the root entirely', () => {
  assert.equal(isPathInside('/x/y', '/a/b'), false);
});

test('resolves relative paths against the current working directory before comparing', () => {
  const root = process.cwd();
  assert.equal(isPathInside(path.join('some', 'nested', 'file.json'), root), true);
});
