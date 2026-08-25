const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const {
  SIDELOAD_APK_PATH,
  SIDELOAD_APK_NAMESPACE_PREFIX,
  resolveSideloadApkFile,
  BUBBLE_APPLICATION_ID,
  buildPairPageHtml,
} = require('../out/bridge/bridgeServer');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-788 invariants, coder-authored per BL-654 (first authorship of a
// declared invariant's property test rests with the coder).
//
// Runs ONLY via `npm run test:properties`; excluded from unit/coverage/
// mutation (vitest.config.mjs excludes **/*.property.test.js).

const REPO_ROOT = path.join(__dirname, '..', '..');
const GRADLE_FILE = path.join(REPO_ROOT, 'android', 'app', 'build.gradle.kts');

// Any character that could plausibly appear in a hand-typed or maliciously
// crafted suffix - path separators (both slash directions), percent-encoded
// sequences (single and double), dot-segments, unicode, nulls, and safe
// filename characters mixed in so a poisoned suffix still looks plausible
// rather than obviously-random.
const SUFFIX_CHARS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-',
  '/', '\\', '%2e', '%2f', '%252e', '%252f', '..', '#', '?', '\0', 'é', '中',
];
const suffixArb = fc.array(fc.constantFrom(...SUFFIX_CHARS), { minLength: 0, maxLength: 16 }).map((cs) => cs.join(''));

test('BL-788 invariant 1: every request under the sideload namespace prefix either resolves inside the public dir or is never resolved at all', () => {
  const root = mkTmpDir('sfvc-bl788-namespace-property-');
  const publicRoot = path.join(root, 'public');
  fs.mkdirSync(publicRoot, { recursive: true });

  fc.assert(
    fc.property(suffixArb, (suffix) => {
      const pathname = `${SIDELOAD_APK_NAMESPACE_PREFIX}${suffix}`;
      const claimed = pathname.startsWith(SIDELOAD_APK_NAMESPACE_PREFIX);
      // The prefix is a literal string check against pathname's own start -
      // any pathname built by concatenating the prefix with a suffix is
      // claimed by construction. This holds for every generated suffix,
      // including ones that also happen to alter what SIDELOAD_APK_PATH
      // matches - the two checks are independent.
      if (!claimed) return false;
      // Plant a REAL file at whatever basename this pathname would resolve
      // to, so a pattern gate that let this pathname through would find
      // something real to serve. Without this, a broken gate would go
      // undetected simply because nothing happens to exist at that name -
      // the property would be vacuously true, not actually discharged.
      const basename = path.basename(pathname);
      if (basename && basename !== '.' && basename !== '..') {
        try {
          fs.writeFileSync(path.join(publicRoot, basename), 'planted-bytes');
        } catch {
          // basename is not a legal filename on this OS (e.g. a null byte) -
          // nothing to plant, and resolveSideloadApkFile could not possibly
          // find a real file there either.
        }
      }
      const resolved = resolveSideloadApkFile(pathname, publicRoot);
      if (!SIDELOAD_APK_PATH.test(pathname)) {
        // A claimed-but-pattern-mismatching path must never resolve to
        // anything - the dispatcher 404s it without ever calling
        // resolveSideloadApkFile against a filesystem lookup.
        return resolved === null;
      }
      // A claimed AND pattern-matching path may resolve, but only inside
      // the public root.
      return resolved === null || resolved.startsWith(path.resolve(publicRoot) + path.sep);
    }),
    { numRuns: 500 }
  );
});

test('BL-788 invariant 2: the pairing page always names the id the shipped build installs under, regardless of adversarial input', () => {
  const gradleSource = fs.readFileSync(GRADLE_FILE, 'utf8');
  const match = gradleSource.match(/applicationId\s*=\s*"([^"]+)"/);
  assert.ok(match, 'expected to find an applicationId assignment in build.gradle.kts');
  assert.equal(
    BUBBLE_APPLICATION_ID,
    match[1],
    'bridgeServer.ts\'s BUBBLE_APPLICATION_ID has drifted from android/app/build.gradle.kts\'s applicationId'
  );

  // Even adversarial bridgeUrl/token values (attempting to inject a `#` or
  // `;` to smuggle a different package= into the Intent URI fragment) must
  // never change the rendered package id - encodeURIComponent escapes both
  // characters in the query portion, and the fragment's package= comes
  // from the fixed constant, never from either input.
  fc.assert(
    fc.property(fc.string(), fc.string(), (bridgeUrl, token) => {
      const html = buildPairPageHtml(bridgeUrl, token);
      return html.includes(`package=${BUBBLE_APPLICATION_ID};end`);
    }),
    { numRuns: 300 }
  );
});

// Non-vacuousness lock-down: concrete cases proving the properties above
// actually reach the states they claim to.
test('BL-788: concrete cases the properties above generalize', () => {
  const root = mkTmpDir('sfvc-bl788-namespace-property-concrete-');
  const publicRoot = path.join(root, 'public');
  fs.mkdirSync(publicRoot, { recursive: true });

  assert.equal(resolveSideloadApkFile('/swarmforge-float-companion/../../../../etc/passwd.apk', publicRoot), null);
  assert.equal(resolveSideloadApkFile('/swarmforge-float-companion%2f..%2f..%2fsecrets.apk', publicRoot), null);
  assert.ok('/swarmforge-float-companion/../../../../etc/passwd.apk'.startsWith(SIDELOAD_APK_NAMESPACE_PREFIX));

  // A token containing raw #/;/= characters is a realistic adversarial
  // input (an attacker who can influence the query-string token trying to
  // smuggle a second package= into the Intent URI fragment). The copy-
  // fallback section displays the token verbatim as informational text (by
  // design - a human must be able to read/copy exactly what they typed),
  // so the assertion below is scoped to the <a href="..."> attribute only,
  // not the whole page.
  const html = buildPairPageHtml('https://example.com', 'tok#Intent;package=evil.app;end');
  const hrefMatch = html.match(/<a href="([^"]*)">/);
  assert.ok(hrefMatch, 'expected an <a href="..."> pairing link in the page');
  const href = hrefMatch[1];
  assert.ok(href.includes(`package=${BUBBLE_APPLICATION_ID};end`));
  assert.ok(!href.includes('package=evil.app'));
});
