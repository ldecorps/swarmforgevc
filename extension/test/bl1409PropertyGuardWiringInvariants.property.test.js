'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');

const { propertyGuardIsWired } = require(
  path.join(__dirname, '..', '..', 'specs', 'pipeline', 'steps', 'lib', 'bl1409PropertyGuardWiring.js')
);

// BL-1409 declared invariants:
//   1. The check asserts reachability through the WHOLE chain, never a
//      literal in one file: wired iff the hook invokes run_commit_guards.sh
//      in a non-comment line AND the runner's own derived guard set names
//      check_property_suite_drift.sh.
//   2. Exactly one parser of run_guard lines exists in the repo: the check
//      consumes BL-1398's deriveCommitGuardFixtureSet for the runner hop,
//      never a second run_guard-line parser of its own.
//   3. Non-vacuous: for every chain where either hop is broken, the check
//      fails naming the missing hop.
//
// P1 (invariants 1 + 3, the load-bearing property, generative): random seam
//    configurations - the hook may exec the runner, name it only in a
//    comment, or omit it; the runner may name the property guard among a
//    random set of OTHER guards, omit it, or name it only in a comment of
//    its own - propertyGuardIsWired's own verdict is checked against an
//    independent oracle built from the SAME generated shape.
// Invariant 2 is structural (no property-shaped domain to range over): the
// module's own source is read and checked for a second run_guard-line
// parser outside its own comments, below.

const OTHER_GUARD_NAMES = ['check_commit_size.sh', 'check_ticket_deletion.sh', 'check_pipeline_code_on_main.sh', 'check_feature_handler_registration.sh'];
const GUARD_NAME = 'check_property_suite_drift.sh';
const RUNNER_REL = 'swarmforge/scripts/run_commit_guards.sh';

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

// hookShape: 'execs' | 'comment-only' | 'absent'
// runnerShape: 'names' | 'comment-only' | 'absent'
const seamArb = fc.record({
  hookShape: fc.constantFrom('execs', 'comment-only', 'absent'),
  runnerShape: fc.constantFrom('names', 'comment-only', 'absent'),
  otherGuards: fc.uniqueArray(fc.constantFrom(...OTHER_GUARD_NAMES), { minLength: 0, maxLength: OTHER_GUARD_NAMES.length }),
});

function buildSeam({ hookShape, runnerShape, otherGuards }) {
  // BL-1280: the shared mkTmpDir helper, never a raw fs.mkdtempSync - swept
  // per-test by tmpDirSetup.js's afterEach (wired into both vitest configs),
  // not this file's own ad hoc process-exit cleanup.
  const root = mkTmpDir('sfvc-bl1409-prop-');

  const hookLines = ['#!/usr/bin/env bash', 'set -euo pipefail'];
  if (hookShape === 'comment-only') {
    hookLines.push(`# exec "$REPO_ROOT/${RUNNER_REL}" "$REPO_ROOT"`);
    hookLines.push('exit 0');
  } else if (hookShape === 'execs') {
    hookLines.push('REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"');
    hookLines.push(`exec "$REPO_ROOT/${RUNNER_REL}" "$REPO_ROOT"`);
  } else {
    hookLines.push('exit 0');
  }
  writeFile(path.join(root, 'swarmforge', 'git-hooks', 'pre-commit'), hookLines.join('\n') + '\n');

  const runnerLines = ['#!/usr/bin/env bash', 'set -uo pipefail'];
  for (const g of otherGuards) {
    runnerLines.push(`run_guard ${g}`);
    writeFile(path.join(root, 'swarmforge', 'scripts', g), '#!/usr/bin/env bash\nexit 0\n');
  }
  if (runnerShape === 'comment-only') {
    runnerLines.push(`# run_guard ${GUARD_NAME}`);
  } else if (runnerShape === 'names') {
    runnerLines.push(`run_guard ${GUARD_NAME}`);
    writeFile(path.join(root, 'swarmforge', 'scripts', GUARD_NAME), '#!/usr/bin/env bash\nexit 0\n');
  }
  writeFile(path.join(root, RUNNER_REL), runnerLines.join('\n') + '\n');

  return root;
}

// Independent oracle: never calls propertyGuardIsWired, built from the SAME
// generated shape directly.
function oracleWired({ hookShape, runnerShape }) {
  return hookShape === 'execs' && runnerShape === 'names';
}

function oracleMissing({ hookShape, runnerShape }) {
  if (hookShape !== 'execs') return path.basename(RUNNER_REL);
  if (runnerShape !== 'names') return GUARD_NAME;
  return undefined;
}

test('BL-1409 P1 (invariants 1 and 3): wired iff both hops hold; a broken hop always fails naming itself', () => {
  fc.assert(
    fc.property(seamArb, (shape) => {
      const root = buildSeam(shape);
      const result = propertyGuardIsWired({ repoRoot: root });
      const expectedWired = oracleWired(shape);
      assert.equal(result.wired, expectedWired, `expected wired=${expectedWired} for ${JSON.stringify(shape)}, got: ${JSON.stringify(result)}`);
      if (!expectedWired) {
        assert.equal(result.missing, oracleMissing(shape), `expected missing="${oracleMissing(shape)}" for ${JSON.stringify(shape)}, got: ${JSON.stringify(result)}`);
      }
    }),
    { numRuns: 200 }
  );
});

// Hardener addition: the hook FILE itself missing from disk (as opposed to
// present but not invoking the runner - the seamArb's 'absent' hookShape
// above always writes a hook file, just one that doesn't exec the runner)
// had zero coverage. Confirmed by hand-mutation: deleting the `!exists`
// early-return entirely left both this file's tests and the acceptance
// feature green (readFile would throw ENOENT, but nothing asserts on the
// thrown error's shape). Also fixes a real mislabeling found while writing
// this: `missing` reported the RUNNER's name for a missing HOOK file - the
// `reason` string named the hook correctly, `missing` did not, which would
// point a reader debugging "why is this failing" at the wrong file.
test('BL-1409 (hardener addition): a hook FILE literally missing from disk fails naming the hook, not the runner', () => {
  const root = mkTmpDir('sfvc-bl1409-prop-missing-hook-');
  const result = propertyGuardIsWired({ repoRoot: root });
  assert.equal(result.wired, false);
  assert.equal(result.missing, 'pre-commit', `expected the missing hop named as the hook itself, got: ${JSON.stringify(result)}`);
  assert.match(result.reason, /does not exist/, `expected the reason to say the hook does not exist, got: ${JSON.stringify(result)}`);
});

test('BL-1409 invariant 2 (structural): exactly one parser of run_guard lines - the module never greps run_guard itself', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'specs', 'pipeline', 'steps', 'lib', 'bl1409PropertyGuardWiring.js'),
    'utf8'
  );
  const codeLines = source.split('\n').filter((line) => !/^\s*\/\//.test(line.trim()));
  const codeOnly = codeLines.join('\n');
  assert.doesNotMatch(codeOnly, /run_guard/, `expected no "run_guard" text outside comments (a second parser), found in:\n${codeOnly}`);
  assert.match(source, /deriveCommitGuardFixtureSet/, 'expected the module to consume BL-1398\'s helper');
});
