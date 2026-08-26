const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fc = require('fast-check');

// BL-714 invariant: "No gitignored vitest/vite cache artifact under
// node_modules is tracked in git; a full-suite residual scan never fails
// solely because a tracked cache blob contains a retired word."
//
// The fix is a single /gitignore/ pattern (/node_modules/) covering the
// whole root node_modules tree. A pinned example (the one blob BL-714 found
// tracked) would only prove that ONE path is safe now; it says nothing about
// the next Vite/Vitest cache hash directory the next `npx vitest` run
// creates. This property instead fuzzes the hash segment, the nesting depth,
// and the cache filename so the guarantee is "no such artifact, present or
// future", not "this one blob".
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
const REPO_ROOT = path.join(__dirname, '..', '..');

const hexSegmentArb = fc.stringMatching(/^[0-9a-f]{6,40}$/);
const cacheFileArb = fc.constantFrom('results.json', 'deps.json', 'manifest.json', '_metadata.json');
const nestedSegmentsArb = fc.array(hexSegmentArb, { minLength: 0, maxLength: 3 });

function isGitIgnored(relativePath) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', relativePath], { cwd: REPO_ROOT });
    return true;
  } catch (err) {
    if (typeof err.status === 'number') {
      return false;
    }
    throw err;
  }
}

test('every generated node_modules/.vite/vitest cache path is git-ignored from the repo root', () => {
  fc.assert(
    fc.property(hexSegmentArb, nestedSegmentsArb, cacheFileArb, (hash, extraSegments, filename) => {
      const relativePath = path.join('node_modules', '.vite', 'vitest', hash, ...extraSegments, filename);
      assert.equal(isGitIgnored(relativePath), true, `expected ${relativePath} to be git-ignored`);
    }),
    { numRuns: 50 },
  );
});

test('non-vacuous: a path outside node_modules is NOT reported ignored by the same pattern', () => {
  assert.equal(isGitIgnored(path.join('extension', 'test', 'rootNodeModulesCacheIgnored.property.test.js')), false);
});
