const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  extractShellAssetPaths,
  toRelativeFilePath,
  computeShellContentHash,
  deriveCacheName,
  stampCacheName,
  stampPwaCacheNameInPlace,
  CACHE_NAME_PLACEHOLDER,
} = require('../out/tools/stamp-pwa-cache-name');

const SW_JS_SOURCE = [
  "const CACHE_NAME = '__PWA_CACHE_NAME_PLACEHOLDER__';",
  "const SHELL_ASSETS = ['./', './index.html', './app.js', './locales.js', './manifest.json', './icon.svg'];",
].join('\n');

// ── extractShellAssetPaths (pure) ───────────────────────────────────────

test('extractShellAssetPaths reads every string literal out of the SHELL_ASSETS array', () => {
  assert.deepEqual(extractShellAssetPaths(SW_JS_SOURCE), [
    './',
    './index.html',
    './app.js',
    './locales.js',
    './manifest.json',
    './icon.svg',
  ]);
});

test('extractShellAssetPaths throws a clear error when sw.js has no SHELL_ASSETS array', () => {
  assert.throws(() => extractShellAssetPaths('const CACHE_NAME = "x";'), /SHELL_ASSETS/);
});

// ── toRelativeFilePath (pure) ────────────────────────────────────────────

test('toRelativeFilePath strips the "./" prefix from a real asset path', () => {
  assert.equal(toRelativeFilePath('./index.html'), 'index.html');
});

test('toRelativeFilePath returns null for the bare root entry (no distinct file)', () => {
  assert.equal(toRelativeFilePath('./'), null);
});

// ── computeShellContentHash / deriveCacheName (pure) ─────────────────────

test('computeShellContentHash is deterministic for the same content', () => {
  const a = computeShellContentHash(['one', 'two', 'three']);
  const b = computeShellContentHash(['one', 'two', 'three']);
  assert.equal(a, b);
});

test('computeShellContentHash differs when any file content differs', () => {
  const a = computeShellContentHash(['one', 'two', 'three']);
  const b = computeShellContentHash(['one', 'TWO', 'three']);
  assert.notEqual(a, b);
});

test('computeShellContentHash differs when the content order differs (order-sensitive)', () => {
  const a = computeShellContentHash(['one', 'two']);
  const b = computeShellContentHash(['two', 'one']);
  assert.notEqual(a, b);
});

test('deriveCacheName prefixes the hash with the stable "swarmforge-dashboard-" name', () => {
  assert.equal(deriveCacheName('abc123'), 'swarmforge-dashboard-abc123');
});

// ── stampCacheName (pure) ────────────────────────────────────────────────

test('stampCacheName replaces the placeholder with the derived cache name', () => {
  const stamped = stampCacheName(SW_JS_SOURCE, 'swarmforge-dashboard-abc123');
  assert.match(stamped, /const CACHE_NAME = 'swarmforge-dashboard-abc123';/);
  assert.doesNotMatch(stamped, new RegExp(CACHE_NAME_PLACEHOLDER));
});

test('stampCacheName throws when the placeholder is missing (never silently no-ops)', () => {
  assert.throws(() => stampCacheName("const CACHE_NAME = 'already-stamped';", 'x'), /placeholder/);
});

// ── stampPwaCacheNameInPlace (real fs, temp dirs - the BL-249 acceptance shape) ──

function mkSiteDir(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-pwa-cache-stamp-'));
  fs.writeFileSync(path.join(dir, 'sw.js'), overrides.swJs ?? SW_JS_SOURCE);
  fs.writeFileSync(path.join(dir, 'index.html'), overrides.indexHtml ?? '<html>shell</html>');
  fs.writeFileSync(path.join(dir, 'app.js'), overrides.appJs ?? 'console.log("app");');
  fs.writeFileSync(path.join(dir, 'locales.js'), overrides.localesJs ?? 'const L = {};');
  fs.writeFileSync(path.join(dir, 'manifest.json'), overrides.manifestJson ?? '{"name":"SwarmForge"}');
  fs.writeFileSync(path.join(dir, 'icon.svg'), overrides.iconSvg ?? '<svg></svg>');
  return dir;
}

// BL-249 shell-change-reaches-users-01 / no-manual-bump-03
test('stampPwaCacheNameInPlace writes a content-derived CACHE_NAME into the served sw.js, no manual version string', () => {
  const dir = mkSiteDir();

  const cacheName = stampPwaCacheNameInPlace(dir);

  assert.match(cacheName, /^swarmforge-dashboard-[0-9a-f]{12}$/);
  const written = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
  assert.match(written, new RegExp(`const CACHE_NAME = '${cacheName}';`));
});

// BL-249 shell-change-reaches-users-01
test('changing any shell asset changes the resulting CACHE_NAME', () => {
  const before = stampPwaCacheNameInPlace(mkSiteDir());
  const after = stampPwaCacheNameInPlace(mkSiteDir({ appJs: 'console.log("a NEW app");' }));

  assert.notEqual(before, after);
});

// BL-249 unchanged-shell-no-churn-02
test('a byte-for-byte-identical shell yields the exact same CACHE_NAME across two separate deploys', () => {
  const first = stampPwaCacheNameInPlace(mkSiteDir());
  const second = stampPwaCacheNameInPlace(mkSiteDir());

  assert.equal(first, second);
});

test('stampPwaCacheNameInPlace throws if the served sw.js has already been stamped (placeholder consumed)', () => {
  const dir = mkSiteDir();
  stampPwaCacheNameInPlace(dir);

  assert.throws(() => stampPwaCacheNameInPlace(dir), /placeholder/);
});
