const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { resolveSideloadApkFile, SIDELOAD_APK_PATH } = require('../out/bridge/bridgeServer');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-851 invariants, coder-authored per BL-654 (first authorship of a
// declared invariant's property test rests with the coder).
//
// Runs ONLY via `npm run test:properties`; excluded from unit/coverage/
// mutation (vitest.config.mjs excludes **/*.property.test.js).

const SAFE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-'.split('');
const safeSuffixArb = fc
  .array(fc.constantFrom(...SAFE_CHARS), { minLength: 1, maxLength: 24 })
  .map((cs) => cs.join(''));

// Characters that must never let a request through, injected into an
// otherwise-legit-shaped name so the near-miss is structurally close to a
// real file's name rather than unrelated random noise.
const POISON_CHARS = ['/', '\\', '%', '..', 'é', '中', '#', '?', '\0'];

function apkName(suffix) {
  return `swarmforge-float-companion-${suffix}.apk`;
}

// Every generated (kind, suffix) pair builds its OWN fixture entry inside
// publicRoot before resolving - the escape-symlink and directory cases are
// constructed to collide with the naming pattern on every run, not hoped to
// be hit by unstructured random strings (which practically never match
// SIDELOAD_APK_PATH's restrictive charset).
function plantFixtureEntry(publicRoot, secretPath, kind, suffix) {
  const name = apkName(suffix);
  const entryPath = path.join(publicRoot, name);
  fs.rmSync(entryPath, { force: true, recursive: true });
  if (kind === 'legit') {
    fs.writeFileSync(entryPath, `legit-bytes-${suffix}`);
  } else if (kind === 'escapeSymlink') {
    fs.symlinkSync(secretPath, entryPath);
  } else if (kind === 'directory') {
    fs.mkdirSync(entryPath);
  }
  return { name, entryPath };
}

test('BL-851 invariant 1: never resolves to a directory, a symlink, or a path outside the public dir', () => {
  const root = mkTmpDir('sfvc-sideload-apk-property-');
  const publicRoot = path.join(root, 'public');
  fs.mkdirSync(publicRoot, { recursive: true });
  const secretDir = mkTmpDir('sfvc-sideload-apk-secret-');
  const secretPath = path.join(secretDir, 'host-secret.bin');
  fs.writeFileSync(secretPath, 'host-secret-bytes');
  const realRoot = fs.realpathSync(publicRoot);

  fc.assert(
    fc.property(
      fc.constantFrom('legit', 'escapeSymlink', 'directory'),
      safeSuffixArb,
      (kind, suffix) => {
        const { name } = plantFixtureEntry(publicRoot, secretPath, kind, suffix);
        const resolved = resolveSideloadApkFile(`/${name}`, publicRoot);
        if (kind === 'legit') {
          if (resolved === null) return false;
          const lst = fs.lstatSync(resolved);
          return (
            !lst.isSymbolicLink() &&
            lst.isFile() &&
            fs.realpathSync(resolved).startsWith(realRoot + path.sep)
          );
        }
        // escapeSymlink and directory: the invariant is that NEITHER is
        // ever servable, however many distinct suffixes/targets we try.
        return resolved === null;
      }
    ),
    { numRuns: 300 }
  );
});

test('BL-851 invariant 2: a near-miss of the sideload naming pattern is never intercepted', () => {
  const root = mkTmpDir('sfvc-sideload-apk-property-nearmiss-');
  const publicRoot = path.join(root, 'public');
  fs.mkdirSync(publicRoot, { recursive: true });

  // A poisoned name still contains a real, existing legit file's suffix as
  // a substring, so a defect that over-matches (e.g. a widened regex, or a
  // decode step added ahead of the check) would resolve it to that real
  // file instead of correctly rejecting - a bare "returns null" assertion
  // on unrelated random junk would not catch that failure mode.
  fc.assert(
    fc.property(safeSuffixArb, fc.constantFrom(...POISON_CHARS), fc.nat({ max: 10 }), (suffix, poison, position) => {
      const cleanName = apkName(suffix);
      fs.writeFileSync(path.join(publicRoot, cleanName), `legit-bytes-${suffix}`);
      const idx = Math.min(position, cleanName.length);
      const poisoned = cleanName.slice(0, idx) + poison + cleanName.slice(idx);
      // A poisoned name that happens to still fully match the pattern
      // (e.g. inserting another safe '.' or '-') is not a near-miss -
      // skip it rather than asserting a false failure.
      fc.pre(!SIDELOAD_APK_PATH.test(`/${poisoned}`));
      const resolved = resolveSideloadApkFile(`/${poisoned}`, publicRoot);
      return resolved === null;
    }),
    { numRuns: 300 }
  );
});

// Non-vacuousness lock-down: concrete cases proving the property generator
// above actually reaches the states it claims to, independent of any given
// fast-check seed.
test('BL-851: concrete escape-symlink and near-miss cases the properties above generalize', () => {
  const root = mkTmpDir('sfvc-sideload-apk-property-concrete-');
  const publicRoot = path.join(root, 'public');
  fs.mkdirSync(publicRoot, { recursive: true });
  const secretDir = mkTmpDir('sfvc-sideload-apk-secret-concrete-');
  const secretPath = path.join(secretDir, 'host-secret.bin');
  fs.writeFileSync(secretPath, 'host-secret-bytes');

  const escapeName = apkName('escape');
  fs.symlinkSync(secretPath, path.join(publicRoot, escapeName));
  assert.equal(resolveSideloadApkFile(`/${escapeName}`, publicRoot), null);

  const dirName = apkName('a-directory');
  fs.mkdirSync(path.join(publicRoot, dirName));
  assert.equal(resolveSideloadApkFile(`/${dirName}`, publicRoot), null);

  const legitName = apkName('1.0.0');
  fs.writeFileSync(path.join(publicRoot, legitName), 'legit-bytes');
  // resolveSideloadApkFile resolves lexically (path.resolve never touches
  // the filesystem), so the expectation compares against the same lexical
  // join - not fs.realpathSync, which would also canonicalize macOS's
  // /tmp -> /private/tmp and make an apples-to-oranges comparison.
  assert.equal(resolveSideloadApkFile(`/${legitName}`, publicRoot), path.resolve(path.join(publicRoot, legitName)));

  // Encoded traversal never matches the naming pattern at all - it must
  // never reach the fs layer, let alone resolve.
  assert.equal(resolveSideloadApkFile('/swarmforge-float-companion-%2e%2e%2fsecret.apk', publicRoot), null);
  assert.equal(resolveSideloadApkFile('/swarmforge-float-companion-..\\secret.apk', publicRoot), null);
});
