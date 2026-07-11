const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureStrykerSandboxSiblingLink, ensureStrykerSandboxSiblingLinks } = require('../scripts/strykerSandboxSiblingsLib');

// BL-221/BL-267: the Stryker sandbox never copies a repo-root sibling
// directory (outside extension/), so a test or the code under test
// resolving a path into one - e.g. path.join(__dirname, '..', '..', 'pwa',
// ...) two levels up from extension/test/, or complianceBatteryGate.ts's
// REPO_ROOT three levels up from extension/out/recruiter/ - ENOENTs inside
// the sandbox. Both resolutions bottom out at the same shared parent
// (.stryker-tmp/<name>), so ensureStrykerSandboxSiblingLink must make
// exactly that path resolve to the real sibling directory, for ANY sibling
// name - not just pwa.

function mkFixture(siblingName) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-stryker-sandbox-'));
  const extensionDir = path.join(root, 'extension');
  const siblingDir = path.join(root, siblingName);
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.mkdirSync(siblingDir, { recursive: true });
  fs.writeFileSync(path.join(siblingDir, 'marker'), `${siblingName}-content`);
  return { root, extensionDir, siblingDir };
}

// The same behavioral contract, run for every confirmed sibling (BL-221's
// pwa/, BL-267's swarmforge/, .github/, docs/) - a regression in any one is
// a real bug, not just a pwa-specific one. .github/ is included here
// specifically to prove the mechanism handles a dot-prefixed directory name
// the same as an ordinary one (symlink creation, path joining).
for (const siblingName of ['pwa', 'swarmforge', '.github', 'docs']) {
  test(`creates a symlink at <extensionDir>/.stryker-tmp/${siblingName} pointing at the sibling ${siblingName}/ dir`, () => {
    const { extensionDir, siblingDir } = mkFixture(siblingName);

    const result = ensureStrykerSandboxSiblingLink(extensionDir, '.stryker-tmp', siblingName);

    assert.equal(result.created, true);
    assert.equal(result.siblingName, siblingName);
    assert.equal(fs.lstatSync(result.linkPath).isSymbolicLink(), true);
    assert.equal(fs.realpathSync(result.linkPath), fs.realpathSync(siblingDir));
  });

  test(`the ${siblingName} symlinked path resolves exactly the same way a sandboxed test's two-levels-up require would`, () => {
    const { extensionDir } = mkFixture(siblingName);

    ensureStrykerSandboxSiblingLink(extensionDir, '.stryker-tmp', siblingName);

    const simulatedSandboxTestDir = path.join(extensionDir, '.stryker-tmp', 'sandbox-abc123', 'test');
    const resolved = path.join(simulatedSandboxTestDir, '..', '..', siblingName, 'marker');
    assert.equal(fs.readFileSync(resolved, 'utf8'), `${siblingName}-content`);
  });

  test(`is idempotent for ${siblingName}: a second call reports created:false and leaves the link intact`, () => {
    const { extensionDir, siblingDir } = mkFixture(siblingName);

    ensureStrykerSandboxSiblingLink(extensionDir, '.stryker-tmp', siblingName);
    const second = ensureStrykerSandboxSiblingLink(extensionDir, '.stryker-tmp', siblingName);

    assert.equal(second.created, false);
    assert.equal(fs.realpathSync(second.linkPath).toString(), fs.realpathSync(siblingDir).toString());
  });

  test(`replaces a stale ${siblingName} symlink (e.g. pointing at a since-removed sandbox layout) rather than leaving it broken`, () => {
    const { extensionDir, siblingDir } = mkFixture(siblingName);
    const tempDir = path.join(extensionDir, '.stryker-tmp');
    fs.mkdirSync(tempDir, { recursive: true });
    fs.symlinkSync('/no/such/path', path.join(tempDir, siblingName), 'dir');

    const result = ensureStrykerSandboxSiblingLink(extensionDir, '.stryker-tmp', siblingName);

    assert.equal(result.created, true);
    assert.equal(fs.realpathSync(result.linkPath), fs.realpathSync(siblingDir));
  });
}

test('creates the temp dir first when it does not exist yet (mirrors Stryker\'s own tempDirName mkdir)', () => {
  const { extensionDir } = mkFixture('pwa');
  assert.equal(fs.existsSync(path.join(extensionDir, '.stryker-tmp')), false);

  ensureStrykerSandboxSiblingLink(extensionDir, '.stryker-tmp', 'pwa');

  assert.equal(fs.existsSync(path.join(extensionDir, '.stryker-tmp')), true);
});

test('replaces a real directory left at the link path (e.g. from an older copy-based fix) with the symlink', () => {
  const { extensionDir, siblingDir } = mkFixture('pwa');
  const tempDir = path.join(extensionDir, '.stryker-tmp');
  const staleDir = path.join(tempDir, 'pwa');
  fs.mkdirSync(staleDir, { recursive: true });
  fs.writeFileSync(path.join(staleDir, 'stale.html'), 'stale');

  const result = ensureStrykerSandboxSiblingLink(extensionDir, '.stryker-tmp', 'pwa');

  assert.equal(fs.lstatSync(result.linkPath).isSymbolicLink(), true);
  assert.equal(fs.realpathSync(result.linkPath), fs.realpathSync(siblingDir));
});

test('does not disturb a sibling sandbox-<id> directory already present in the temp dir', () => {
  const { extensionDir } = mkFixture('pwa');
  const tempDir = path.join(extensionDir, '.stryker-tmp');
  const sandboxDir = path.join(tempDir, 'sandbox-existing');
  fs.mkdirSync(sandboxDir, { recursive: true });
  fs.writeFileSync(path.join(sandboxDir, 'marker.txt'), 'keep-me');

  ensureStrykerSandboxSiblingLink(extensionDir, '.stryker-tmp', 'pwa');

  assert.equal(fs.readFileSync(path.join(sandboxDir, 'marker.txt'), 'utf8'), 'keep-me');
});

// BL-267: the whole point of generalizing - one call links every sibling
// in the list, so covering the NEXT one is an added name, not a new call site.
test('ensureStrykerSandboxSiblingLinks links every sibling in the given list, independently', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-stryker-sandbox-'));
  const extensionDir = path.join(root, 'extension');
  fs.mkdirSync(extensionDir, { recursive: true });
  const names = ['pwa', 'swarmforge', '.github', 'docs'];
  for (const name of names) {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'marker'), `${name}-content`);
  }

  const results = ensureStrykerSandboxSiblingLinks(extensionDir, '.stryker-tmp', names);

  assert.equal(results.length, 4);
  assert.deepEqual(results.map((r) => r.siblingName), names);
  for (const name of names) {
    const linkPath = path.join(extensionDir, '.stryker-tmp', name);
    assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(path.join(linkPath, 'marker'), 'utf8'), `${name}-content`);
  }
});

test('ensureStrykerSandboxSiblingLinks does not disturb one sibling link while creating another', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-stryker-sandbox-'));
  const extensionDir = path.join(root, 'extension');
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'pwa'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });

  ensureStrykerSandboxSiblingLink(extensionDir, '.stryker-tmp', 'pwa');
  const pwaLinkBefore = fs.readlinkSync(path.join(extensionDir, '.stryker-tmp', 'pwa'));

  ensureStrykerSandboxSiblingLinks(extensionDir, '.stryker-tmp', ['pwa', 'swarmforge']);

  assert.equal(fs.readlinkSync(path.join(extensionDir, '.stryker-tmp', 'pwa')), pwaLinkBefore);
  assert.equal(fs.lstatSync(path.join(extensionDir, '.stryker-tmp', 'swarmforge')).isSymbolicLink(), true);
});
