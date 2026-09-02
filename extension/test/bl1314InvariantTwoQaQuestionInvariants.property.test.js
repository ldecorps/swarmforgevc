'use strict';

// BL-1314 declared invariants, each encoded as an executable property.
// Runs ONLY via `npm run test:properties`.
//
// 1. "The assertion fails when, and only when, a file answers the
//    QA-approved-tip question outside is_qa_ancestor.sh. An ancestry call
//    over any other pair of refs is not a violation and must not fail it."
// 2. "The positive half is not weakened while the negative half is scoped:
//    removing the is_qa_ancestor.sh call from either file still fails the
//    assertion."
//
// Both drive the REAL `inv2_qa_definition_violations` from
// swarmforge/scripts/invariant2_qa_definition_lib.sh, sourced in bash,
// against generated fixture files. A JS re-statement of the greps would be a
// second definition of exactly the thing invariant 2 is about.
//
// Generator reach (the asserted floor, not a hoped-for one): the ref-pair
// generator does NOT draw its refs from unrelated noise. Every non-QA ref is
// built as a NEAR MISS of "swarmforge-QA" - case-flipped, separator-swapped,
// truncated, reversed, or namespaced - so each generated helper is a
// collision candidate by construction. Drawing arbitrary strings would
// essentially never produce a ref that looks like the QA ref, and the
// property would pass against a matcher that scanned for "QA" alone or for
// any ancestry call at all (the very defect this ticket fixes).
//
// KNOWN LIMIT, deliberately not asserted: the pin is a grep, so an ancestry
// call against a ref whose name CONTAINS "swarmforge-QA" as a substring (say
// "swarmforge-QAX") reads as the QA question. Such refs are excluded from the
// non-QA generator rather than pinned to a verdict the grep cannot honour -
// the same limit the lib's own header states.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LIB = path.join(SCRIPTS_DIR, 'invariant2_qa_definition_lib.sh');

const QA_REF = 'swarmforge-QA';
const SHARED_DEFINITION = 'is_qa_ancestor.sh';

const CLEAN_GUARD = [
  '#!/usr/bin/env bash',
  'if bash "$SCRIPT_DIR/is_qa_ancestor.sh" "$sha"; then',
  '  echo approved',
  'fi',
  '',
].join('\n');

const CLEAN_HANDOFFD = [
  '#!/usr/bin/env bb',
  '(defn qa-ancestor? [sha]',
  '  (sh! ["bash" (str (fs/path script-dir "is_qa_ancestor.sh")) sha]))',
  '',
].join('\n');

function runPredicate(guardPath, handoffdPath) {
  const script = [
    `source ${JSON.stringify(LIB)}`,
    `inv2_qa_definition_violations ${JSON.stringify(guardPath)} ${JSON.stringify(handoffdPath)}`,
  ].join('\n');
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

// One fixture dir per property, reused across that property's runs; each run
// rewrites both files, so no state leaks between draws.
function withFixture(fn) {
  const root = fs.realpathSync(mkTmpDir('bl1314-inv2-prop-'));
  try {
    return fn({
      guard: path.join(root, 'check_pipeline_code_on_main.sh'),
      handoffd: path.join(root, 'handoffd.bb'),
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Generators: near misses of the QA ref, by construction.
// ---------------------------------------------------------------------------

// Every one of these is derived from "swarmforge-QA" and none contains it as
// a substring - so each is a ref a substring-happy matcher would plausibly
// confuse with the QA ref, and none of them IS the QA question.
const NEAR_MISS_REFS = [
  'swarmforge-qa', // case flipped
  'SWARMFORGE-QA', // fully upper
  'swarmforge_QA', // separator swapped
  'swarmforgeQA', // separator dropped
  'swarmforge-Q', // truncated
  'swarmforge', // prefix only
  'QA-swarmforge', // reversed
  'QA', // the bare word
  'refs/heads/swarmforge-QAtip'.replace('swarmforge-QA', 'swarmforge-Qa'), // namespaced near miss
  'origin/main',
  'HEAD',
  'refs/heads/foo',
];

const nonQaRef = fc.constantFrom(...NEAR_MISS_REFS);

// A helper that asks about SOME pair of refs. `qa` decides whether the pair is
// the QA question; when it is not, both sides are near misses.
const helper = (withQa) =>
  fc
    .tuple(fc.integer({ min: 0, max: 9999 }), nonQaRef, nonQaRef, fc.boolean())
    .map(([n, a, b, qaOnLeft]) => {
      const [left, right] = withQa ? (qaOnLeft ? [QA_REF, a] : [a, QA_REF]) : [a, b];
      return `(defn helper-${n}? []\n  (zero? (:exit (sh! ["git" "merge-base" "--is-ancestor" "${left}" "${right}"]))))`;
    });

const otherQuestionHelpers = fc.array(helper(false), { minLength: 1, maxLength: 6 });
const qaQuestionHelpers = fc.array(helper(true), { minLength: 1, maxLength: 3 });

describe('BL-1314 invariant-2 scoping invariants', () => {
  it('invariant 1a: ancestry over any other pair of refs is never a violation, however many helpers', () => {
    withFixture((files) => {
      fc.assert(
        fc.property(otherQuestionHelpers, (helpers) => {
          // Generator floor: none of these may be the QA question, or the
          // property would be asserting the wrong verdict.
          assert.ok(
            helpers.every((h) => !h.includes(QA_REF)),
            'the non-QA generator produced a helper naming the QA ref'
          );
          assert.ok(
            helpers.every((h) => h.includes('merge-base') && h.includes('--is-ancestor')),
            'the generator produced a helper that is not an ancestry call - the property would be vacuous'
          );
          fs.writeFileSync(files.guard, CLEAN_GUARD);
          fs.writeFileSync(files.handoffd, `${CLEAN_HANDOFFD}${helpers.join('\n')}\n`);
          const { status, output } = runPredicate(files.guard, files.handoffd);
          assert.equal(status, 0, `ancestry over another ref pair was reported as a violation: ${output}`);
        }),
        { numRuns: 60 }
      );
    });
  });

  it('invariant 1b: an inline answer to the QA question is always a violation, and names the file', () => {
    withFixture((files) => {
      fc.assert(
        fc.property(qaQuestionHelpers, otherQuestionHelpers, fc.boolean(), (qaHelpers, noise, noiseFirst) => {
          assert.ok(
            qaHelpers.every((h) => h.includes(QA_REF)),
            'the QA generator produced a helper that does not name the QA ref'
          );
          const body = noiseFirst ? [...noise, ...qaHelpers] : [...qaHelpers, ...noise];
          fs.writeFileSync(files.guard, CLEAN_GUARD);
          fs.writeFileSync(files.handoffd, `${CLEAN_HANDOFFD}${body.join('\n')}\n`);
          const { status, output } = runPredicate(files.guard, files.handoffd);
          assert.notEqual(status, 0, 'a second inline answer to the QA question was not caught');
          assert.ok(output.includes('handoffd.bb'), `the violation does not name handoffd.bb: ${output}`);
          assert.ok(
            !output.includes('check_pipeline_code_on_main.sh'),
            `the intact bash guard was blamed too: ${output}`
          );
        }),
        { numRuns: 40 }
      );
    });
  });

  it('invariant 2: dropping the shared definition from either file still fails, whatever else the file holds', () => {
    withFixture((files) => {
      fc.assert(
        fc.property(
          fc.constantFrom('guard', 'handoffd'),
          otherQuestionHelpers,
          (which, helpers) => {
            // Both files start intact, then ONE loses its call to the shared
            // definition. The other keeps its own, so a failure that named the
            // wrong file would be caught here too.
            const guardBody = CLEAN_GUARD;
            const handoffdBody = `${CLEAN_HANDOFFD}${helpers.join('\n')}\n`;
            const strip = (text) =>
              text
                .split('\n')
                .filter((l) => !l.includes(SHARED_DEFINITION))
                .join('\n');

            fs.writeFileSync(files.guard, which === 'guard' ? strip(guardBody) : guardBody);
            fs.writeFileSync(files.handoffd, which === 'handoffd' ? strip(handoffdBody) : handoffdBody);

            const { status, output } = runPredicate(files.guard, files.handoffd);
            assert.notEqual(status, 0, `dropping ${SHARED_DEFINITION} from the ${which} was not caught`);
            const expected = which === 'guard' ? 'check_pipeline_code_on_main.sh' : 'handoffd.bb';
            const other = which === 'guard' ? 'handoffd.bb' : 'check_pipeline_code_on_main.sh';
            assert.ok(output.includes(expected), `the violation does not name ${expected}: ${output}`);
            assert.ok(!output.includes(other), `the intact ${other} was blamed too: ${output}`);
          }
        ),
        { numRuns: 40 }
      );
    });
  });
});
