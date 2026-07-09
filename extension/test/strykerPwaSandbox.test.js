const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureStrykerPwaSandboxLink } = require('../scripts/strykerPwaSandboxLib');

// BL-221: the Stryker sandbox never copies the sibling pwa/ directory
// (outside extension/), so a test resolving a pwa/ asset via
// path.join(__dirname, '..', '..', 'pwa', ...) ENOENTs inside the sandbox.
// That same two-levels-up path lands at .stryker-tmp/pwa - the shared
// parent of every sandbox-<id> dir - so ensureStrykerPwaSandboxLink must
// make exactly that path resolve to the real pwa/ directory.

function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-stryker-pwa-'));
  const extensionDir = path.join(root, 'extension');
  const pwaDir = path.join(root, 'pwa');
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.mkdirSync(pwaDir, { recursive: true });
  fs.writeFileSync(path.join(pwaDir, 'index.html'), '<html></html>');
  return { root, extensionDir, pwaDir };
}

test('creates a symlink at <extensionDir>/.stryker-tmp/pwa pointing at the sibling pwa/ dir', () => {
  const { extensionDir, pwaDir } = mkFixture();

  const result = ensureStrykerPwaSandboxLink(extensionDir, '.stryker-tmp');

  assert.equal(result.created, true);
  assert.equal(fs.lstatSync(result.linkPath).isSymbolicLink(), true);
  assert.equal(fs.realpathSync(result.linkPath), fs.realpathSync(pwaDir));
});

test('the symlinked path resolves exactly the same way a sandboxed test\'s two-levels-up require would', () => {
  const { extensionDir } = mkFixture();

  ensureStrykerPwaSandboxLink(extensionDir, '.stryker-tmp');

  // Mirrors extension/test/pwaServiceWorker.test.js's own resolution, but
  // from a simulated sandbox test dir two levels under .stryker-tmp.
  const simulatedSandboxTestDir = path.join(extensionDir, '.stryker-tmp', 'sandbox-abc123', 'test');
  const resolved = path.join(simulatedSandboxTestDir, '..', '..', 'pwa', 'index.html');
  assert.equal(fs.readFileSync(resolved, 'utf8'), '<html></html>');
});

test('creates the temp dir first when it does not exist yet (mirrors Stryker\'s own tempDirName mkdir)', () => {
  const { extensionDir } = mkFixture();
  assert.equal(fs.existsSync(path.join(extensionDir, '.stryker-tmp')), false);

  ensureStrykerPwaSandboxLink(extensionDir, '.stryker-tmp');

  assert.equal(fs.existsSync(path.join(extensionDir, '.stryker-tmp')), true);
});

test('is idempotent: a second call reports created:false and leaves the link intact', () => {
  const { extensionDir, pwaDir } = mkFixture();

  ensureStrykerPwaSandboxLink(extensionDir, '.stryker-tmp');
  const second = ensureStrykerPwaSandboxLink(extensionDir, '.stryker-tmp');

  assert.equal(second.created, false);
  assert.equal(fs.realpathSync(second.linkPath).toString(), fs.realpathSync(pwaDir).toString());
});

test('replaces a stale symlink (e.g. pointing at a since-removed sandbox layout) rather than leaving it broken', () => {
  const { extensionDir, pwaDir } = mkFixture();
  const tempDir = path.join(extensionDir, '.stryker-tmp');
  fs.mkdirSync(tempDir, { recursive: true });
  fs.symlinkSync('/no/such/path', path.join(tempDir, 'pwa'), 'dir');

  const result = ensureStrykerPwaSandboxLink(extensionDir, '.stryker-tmp');

  assert.equal(result.created, true);
  assert.equal(fs.realpathSync(result.linkPath), fs.realpathSync(pwaDir));
});

test('replaces a real directory left at the link path (e.g. from an older copy-based fix) with the symlink', () => {
  const { extensionDir, pwaDir } = mkFixture();
  const tempDir = path.join(extensionDir, '.stryker-tmp');
  const stalePwaDir = path.join(tempDir, 'pwa');
  fs.mkdirSync(stalePwaDir, { recursive: true });
  fs.writeFileSync(path.join(stalePwaDir, 'stale.html'), 'stale');

  const result = ensureStrykerPwaSandboxLink(extensionDir, '.stryker-tmp');

  assert.equal(fs.lstatSync(result.linkPath).isSymbolicLink(), true);
  assert.equal(fs.realpathSync(result.linkPath), fs.realpathSync(pwaDir));
});

test('does not disturb a sibling sandbox-<id> directory already present in the temp dir', () => {
  const { extensionDir } = mkFixture();
  const tempDir = path.join(extensionDir, '.stryker-tmp');
  const sandboxDir = path.join(tempDir, 'sandbox-existing');
  fs.mkdirSync(sandboxDir, { recursive: true });
  fs.writeFileSync(path.join(sandboxDir, 'marker.txt'), 'keep-me');

  ensureStrykerPwaSandboxLink(extensionDir, '.stryker-tmp');

  assert.equal(fs.readFileSync(path.join(sandboxDir, 'marker.txt'), 'utf8'), 'keep-me');
});
