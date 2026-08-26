const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  webUiFontSizePreferencePath,
  readWebUiFontSizePreference,
  writeWebUiFontSizePreference,
  resolveWebUiFontSizePx,
} = require('../out/bridge/webUiFontSizePreference');

function mkRoot() {
  return mkTmpDir('sfvc-web-ui-font-');
}

test('readWebUiFontSizePreference: no file yet reports none', () => {
  const root = mkRoot();
  assert.deepEqual(readWebUiFontSizePreference(root, 'live-screen'), { kind: 'none' });
});

test('writeWebUiFontSizePreference then read: round-trips per surface', () => {
  const root = mkRoot();
  const write = writeWebUiFontSizePreference(root, 'pipeline-grid', 18);
  assert.deepEqual(write, { ok: true, fontSizePx: 18 });
  assert.deepEqual(readWebUiFontSizePreference(root, 'pipeline-grid'), { kind: 'stored', fontSizePx: 18 });
  assert.deepEqual(readWebUiFontSizePreference(root, 'paused-pager'), { kind: 'none' });
});

test('writeWebUiFontSizePreference: clamps live-screen to its bounds', () => {
  const root = mkRoot();
  assert.deepEqual(writeWebUiFontSizePreference(root, 'live-screen', 99), { ok: true, fontSizePx: 20 });
  assert.deepEqual(writeWebUiFontSizePreference(root, 'live-screen', 5), { ok: true, fontSizePx: 9 });
});

test('resolveWebUiFontSizePx: corrupt JSON falls back to surface default', () => {
  const root = mkRoot();
  fs.mkdirSync(path.dirname(webUiFontSizePreferencePath(root)), { recursive: true });
  fs.writeFileSync(webUiFontSizePreferencePath(root), '{bad', 'utf8');
  assert.equal(resolveWebUiFontSizePx(root, 'live-screen'), 13);
  assert.equal(resolveWebUiFontSizePx(root, 'pipeline-grid'), 15);
});

test('resolveWebUiFontSizePx: missing surface key falls back to default', () => {
  const root = mkRoot();
  writeWebUiFontSizePreference(root, 'pipeline-grid', 20);
  assert.equal(resolveWebUiFontSizePx(root, 'paused-pager'), 15);
});

test('readWebUiFontSizePreference: non-number surface value reports none', () => {
  const root = mkRoot();
  fs.mkdirSync(path.dirname(webUiFontSizePreferencePath(root)), { recursive: true });
  fs.writeFileSync(webUiFontSizePreferencePath(root), JSON.stringify({ 'live-screen': 'big' }), 'utf8');
  assert.deepEqual(readWebUiFontSizePreference(root, 'live-screen'), { kind: 'none' });
  assert.equal(resolveWebUiFontSizePx(root, 'live-screen'), 13);
});
