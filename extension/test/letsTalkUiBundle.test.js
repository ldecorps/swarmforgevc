const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getLetsTalkUiBundleManifest, isLetsTalkUiBundlePath } = require('../out/bridge/letsTalkUiBundle');

// BL-825 slice A: the bridge-served UI bundle manifest, same fallback
// posture as letsTalkBubbleConfig (BL-765 reuse). Android's UiBundleResolver
// owns the fresh/cached/stale/bare decision; this file only covers what the
// bridge serves.

function mkOperatorDir() {
  const root = mkTmpDir('sfvc-lt-ui-bundle-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function manifestPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'lets-talk-ui-bundle.json');
}

test('isLetsTalkUiBundlePath: matches the served path with and without a trailing query string', () => {
  assert.equal(isLetsTalkUiBundlePath('/lets-talk/ui-bundle.json'), true);
  assert.equal(isLetsTalkUiBundlePath('/lets-talk/ui-bundle.json?x=1'), true);
  assert.equal(isLetsTalkUiBundlePath('/lets-talk/ui-bundle'), true);
  assert.equal(isLetsTalkUiBundlePath('/lets-talk/bubble-config.json'), false);
});

test('getLetsTalkUiBundleManifest: default (no file on disk) is the bundled default, empty payload', () => {
  const root = mkOperatorDir();
  const manifest = getLetsTalkUiBundleManifest(root, {});
  assert.equal(manifest.payload, '');
  assert.equal(manifest.bundleVersion, 0);
});

test('getLetsTalkUiBundleManifest: an on-disk file is served as the manifest', () => {
  const root = mkOperatorDir();
  fs.writeFileSync(
    manifestPath(root),
    JSON.stringify({ schemaVersion: 1, bundleVersion: 7, minShellVersion: 3, payload: '<html></html>' })
  );
  const manifest = getLetsTalkUiBundleManifest(root, {});
  assert.equal(manifest.bundleVersion, 7);
  assert.equal(manifest.minShellVersion, 3);
  assert.equal(manifest.payload, '<html></html>');
});

test('getLetsTalkUiBundleManifest: a malformed on-disk file falls back to the bundled default', () => {
  const root = mkOperatorDir();
  fs.writeFileSync(manifestPath(root), JSON.stringify({ schemaVersion: 1, payload: '<html></html>' }));
  const manifest = getLetsTalkUiBundleManifest(root, {});
  assert.equal(manifest.payload, '');
});

test('getLetsTalkUiBundleManifest: LETS_TALK_UI_BUNDLE_DISABLED forces the bundled default even with a file present', () => {
  const root = mkOperatorDir();
  fs.writeFileSync(
    manifestPath(root),
    JSON.stringify({ schemaVersion: 1, bundleVersion: 7, minShellVersion: 3, payload: '<html></html>' })
  );
  const manifest = getLetsTalkUiBundleManifest(root, { LETS_TALK_UI_BUNDLE_DISABLED: '1' });
  assert.equal(manifest.payload, '');
});

test('getLetsTalkUiBundleManifest: LETS_TALK_UI_BUNDLE_FORCE_ROLLBACK prefers the rollback file over primary', () => {
  const root = mkOperatorDir();
  fs.writeFileSync(
    manifestPath(root),
    JSON.stringify({ schemaVersion: 1, bundleVersion: 7, minShellVersion: 3, payload: 'primary' })
  );
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'lets-talk-ui-bundle.rollback.json'),
    JSON.stringify({ schemaVersion: 1, bundleVersion: 5, minShellVersion: 2, payload: 'rollback' })
  );
  const manifest = getLetsTalkUiBundleManifest(root, { LETS_TALK_UI_BUNDLE_FORCE_ROLLBACK: '1' });
  assert.equal(manifest.payload, 'rollback');
});

test('getLetsTalkUiBundleManifest: LETS_TALK_UI_BUNDLE_FORCE_ROLLBACK with no rollback file falls back to primary', () => {
  const root = mkOperatorDir();
  fs.writeFileSync(
    manifestPath(root),
    JSON.stringify({ schemaVersion: 1, bundleVersion: 7, minShellVersion: 3, payload: 'primary' })
  );
  const manifest = getLetsTalkUiBundleManifest(root, { LETS_TALK_UI_BUNDLE_FORCE_ROLLBACK: '1' });
  assert.equal(manifest.payload, 'primary');
});

test('getLetsTalkUiBundleManifest: no primary file falls back to the rollback file when not forcing rollback', () => {
  const root = mkOperatorDir();
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'lets-talk-ui-bundle.rollback.json'),
    JSON.stringify({ schemaVersion: 1, bundleVersion: 5, minShellVersion: 2, payload: 'rollback' })
  );
  const manifest = getLetsTalkUiBundleManifest(root, {});
  assert.equal(manifest.payload, 'rollback');
});

test('getLetsTalkUiBundleManifest: LETS_TALK_UI_BUNDLE_PATH / _ROLLBACK_PATH override the default operator-dir locations', () => {
  const root = mkOperatorDir();
  const customPrimary = path.join(root, 'custom-primary.json');
  const customRollback = path.join(root, 'custom-rollback.json');
  fs.writeFileSync(
    customPrimary,
    JSON.stringify({ schemaVersion: 1, bundleVersion: 9, minShellVersion: 1, payload: 'custom-primary' })
  );
  fs.writeFileSync(
    customRollback,
    JSON.stringify({ schemaVersion: 1, bundleVersion: 8, minShellVersion: 1, payload: 'custom-rollback' })
  );
  const manifest = getLetsTalkUiBundleManifest(root, {
    LETS_TALK_UI_BUNDLE_PATH: customPrimary,
    LETS_TALK_UI_BUNDLE_ROLLBACK_PATH: customRollback,
  });
  assert.equal(manifest.payload, 'custom-primary');
});

test('getLetsTalkUiBundleManifest: an on-disk file that parses but is not an object (array) falls back to the bundled default', () => {
  const root = mkOperatorDir();
  fs.writeFileSync(manifestPath(root), JSON.stringify([1, 2, 3]));
  const manifest = getLetsTalkUiBundleManifest(root, {});
  assert.equal(manifest.payload, '');
});

test('getLetsTalkUiBundleManifest: an empty-string payload is rejected the same as a missing one', () => {
  const root = mkOperatorDir();
  fs.writeFileSync(
    manifestPath(root),
    JSON.stringify({ schemaVersion: 1, bundleVersion: 7, minShellVersion: 3, payload: '' })
  );
  const manifest = getLetsTalkUiBundleManifest(root, {});
  assert.equal(manifest.payload, '');
  assert.equal(manifest.bundleVersion, 0);
});
