'use strict';

// BL-1401 declared invariants (coder-authored per BL-654 / coder.prompt).
// Runs ONLY via `npm run test:properties`.
//
//   1. The acceptance fixture's copied guard set is a function of
//      run_commit_guards.sh and the two hooks read at run time - never a list
//      in the handler.
//   2. A guard the runner names but the tree lacks fails the scenario loud,
//      naming the guard - never silently skipped.
//   3. Exactly ONE parser of the runner's guard lines exists in the repo: the
//      acceptance handler consumes BL-1398's helper and never carries a second
//      parse.
//
// Invariants 1 and 2 are properties of the helper the handler now consumes,
// and BL-1398's own property file already drives them over generated seams.
// What is new here, and what this file adds, is that the LIVE handler consumes
// it - a helper that is correct and unused would satisfy neither invariant.
//
// GENERATOR REACH is constructed: each case is built from a root and a shape,
// so every draw is a genuine present/absent guard rather than a random string.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { deriveCommitGuardFixtureSet } = require('./helpers/commitGuardFixtureSet');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HANDLER = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'bl632CommitTimeGuardSteps.js');
const CHAIN_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'commit_guard_chain_lib.sh');

const GUARD_NAME = fc.stringMatching(/^[a-z]{3,6}$/).map((s) => `check_${s}.sh`);

function makeSeam(root, named, planted) {
  const scripts = path.join(root, 'swarmforge', 'scripts');
  const hooks = path.join(root, 'swarmforge', 'git-hooks');
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(hooks, { recursive: true });
  fs.copyFileSync(CHAIN_LIB, path.join(scripts, 'commit_guard_chain_lib.sh'));
  fs.writeFileSync(
    path.join(scripts, 'run_commit_guards.sh'),
    ['#!/usr/bin/env bash', 'SCRIPT_DIR="$(dirname "$0")"', 'GUARD_DIR="$SCRIPT_DIR"',
     '. "$SCRIPT_DIR/commit_guard_chain_lib.sh"', ...named.map((g) => `run_guard ${g}`), ''].join('\n'),
  );
  for (const g of planted) {
    fs.writeFileSync(path.join(scripts, g), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  }
  for (const h of ['pre-commit', 'pre-merge-commit']) {
    fs.writeFileSync(path.join(hooks, h), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  }
}

describe('BL-1401 declared invariants', () => {
  it('inv1: the set follows the runner, and inv2: a named-but-absent guard refuses naming it', () => {
    const reach = { complete: 0, missing: 0 };

    fc.assert(
      fc.property(
        fc.uniqueArray(GUARD_NAME, { minLength: 2, maxLength: 5 }),
        fc.boolean(),
        fc.nat(),
        (named, plantAll, pick) => {
          const absent = named[pick % named.length];
          const planted = plantAll ? named : named.filter((g) => g !== absent);
          reach[plantAll ? 'complete' : 'missing'] += 1;

          const root = mkTmpDir('bl1401-prop-');
          try {
            makeSeam(root, named, planted);
            if (plantAll) {
              // inv1: exactly what the runner names, in its order.
              assert.deepEqual(deriveCommitGuardFixtureSet({ repoRoot: root }).guards, named);
            } else {
              // inv2: loud, and naming the guard - never a silent skip.
              assert.throws(
                () => deriveCommitGuardFixtureSet({ repoRoot: root }),
                (err) => err.message.includes(absent),
                `the derivation must refuse naming ${absent}`,
              );
            }
          } finally {
            fs.rmSync(root, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 25 },
    );

    assert.ok(reach.complete > 0 && reach.missing > 0, `both cases must be reached: ${JSON.stringify(reach)}`);
  }, 120000);

  it('inv3: the live handler consumes the helper and carries no second parser', () => {
    const src = fs.readFileSync(HANDLER, 'utf8');

    assert.match(
      src,
      /deriveCommitGuardFixtureSet\s*,?\s*\n?\s*}\s*=\s*require|deriveCommitGuardFixtureSet\(/,
      'the BL-632 handler no longer consumes the shared helper',
    );

    // A second PARSE is a regex over the runner's guard lines. Prose that
    // merely mentions run_guard is not one - the distinction matters, because
    // the honest way to explain this invariant is to name the thing it forbids.
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    assert.doesNotMatch(
      code,
      /run_guard[^\n]*(match|exec|test|split|RegExp|\/g)/,
      'the handler carries its own parse of the runner s guard lines',
    );

    // And the old hand-written list is gone, not merely unused.
    assert.doesNotMatch(
      code,
      /\[\s*GUARD_SCRIPT\s*,\s*'swarmforge\/scripts\//,
      'the hand-written copy list is still there',
    );
  }, 60000);
});
