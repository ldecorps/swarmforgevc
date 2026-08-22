const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { isPathInside, tryRealpath } = require('../out/util/pathContainment');

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

// ── tryRealpath - BL-792 ─────────────────────────────────────────────────

test('tryRealpath resolves an existing path to its canonical form', () => {
  const tmpDir = mkTmpDir('sfvc-tryrealpath-');
  assert.equal(tryRealpath(tmpDir), fs.realpathSync(tmpDir));
});

test('tryRealpath walks up to the nearest existing ancestor for a not-yet-created path, and re-appends the missing tail', () => {
  const tmpDir = mkTmpDir('sfvc-tryrealpath-');
  const notYetCreated = path.join(tmpDir, 'does', 'not', 'exist', 'yet');
  assert.equal(fs.existsSync(notYetCreated), false);
  assert.equal(tryRealpath(notYetCreated), path.join(fs.realpathSync(tmpDir), 'does', 'not', 'exist', 'yet'));
});

test('tryRealpath never throws, even for a path with no existing ancestor at all besides the filesystem root', () => {
  const bogus = path.join(path.parse(os.tmpdir()).root, 'sfvc-definitely-nonexistent-root-child', 'deeper');
  assert.doesNotThrow(() => tryRealpath(bogus));
});
