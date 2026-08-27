'use strict';

// BL-1092 declared invariants for the repo-creation guard.
const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');
const { createsRepository, findRepoCreations } = require('./helpers/repoCreationGuard');

const identArb = fc
  .stringMatching(/^[A-Za-z][A-Za-z0-9]{0,12}$/)
  .filter((s) => s !== 'git' && s !== 'gitIn');

test('property (BL-1092 invariant 1): renaming a git-spawning helper never hides an init call', () => {
  fc.assert(
    fc.property(identArb, (helper) => {
      const text = [
        `function ${helper}(cwd, args) { execFileSync("git", args, { cwd }); }`,
        `${helper}(dir, ['init', '-q']);`,
      ].join('\n');
      assert.equal(createsRepository(text), true, `helper=${helper}`);
    }),
    { numRuns: 40 }
  );
});

test('property (BL-1092 invariant 2): a non-git spawner with an init-shaped call stays unflagged', () => {
  fc.assert(
    fc.property(identArb, (helper) => {
      const text = [
        `function ${helper}(cwd, args) { execFileSync("tar", args, { cwd }); }`,
        `${helper}(dir, ['init', '-q']);`,
      ].join('\n');
      assert.equal(createsRepository(text), false, `helper=${helper}`);
    }),
    { numRuns: 40 }
  );
});

test('property (BL-1092 invariant 2): whole-line string literals stay unflagged', () => {
  fc.assert(
    fc.property(identArb, (helper) => {
      const line = `  "${helper}(dir, ['init', '-q']);",`;
      assert.equal(createsRepository(line), false);
    }),
    { numRuns: 20 }
  );
});

test('BL-1092: live corpus violations stay empty (no new false positives)', () => {
  assert.deepEqual(findRepoCreations(path.join(__dirname)), []);
});
