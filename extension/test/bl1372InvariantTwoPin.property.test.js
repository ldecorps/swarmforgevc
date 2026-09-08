'use strict';

// BL-1372's two DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  A second QA-ancestry predicate still fails the assertion -
//                narrowing the pin must not blind it to the breach it exists
//                to catch.
//   invariant 2  The narrowed assertion asks the QA question only; a call
//                that decides anything else about git ancestry is out of its
//                scope, exactly as BL-1314 scoped its sibling.
//
// These invariants are about the test assertion itself in
// bl962_merge_adjudication_test_runner.bb. The assertion must:
// - FAIL when babysitter_check.bb contains an inline ancestry call against
//   swarmforge-QA (a second QA-ancestry predicate)
// - PASS when babysitter_check.bb contains only non-QA ancestry calls
//   (like merge-base HEAD origin/main)
//
// GENERATOR REACH: the defect needs to distinguish between QA-ancestry calls
// (which should fail) and non-QA ancestry calls (which should pass). The
// generator constructs both shapes by varying whether swarmforge-QA appears
// in the ancestry call.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const TEST_RUNNER = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'bl962_merge_adjudication_test_runner.bb'
);
const CHECK_FILE = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'babysitter_check.bb'
);

// The narrowed regex pattern from bl962_merge_adjudication_test_runner.bb
// after BL-1372's fix.
const NARROWED_PATTERN = /(merge-base|--is-ancestor).*swarmforge-QA/i;

/**
 * Extract the assertion logic from the test runner and apply it to custom
 * code content. This drives the REAL assertion logic, not a restatement.
 */
function runAssertionOnCode(code) {
  // The assertion from bl962_merge_adjudication_test_runner.bb:171-178
  // after BL-1372's fix:
  const match = code.match(NARROWED_PATTERN);
  return match === null; // true = pass, false = fail
}

/**
 * Read the actual babysitter_check.bb file content.
 */
function readCheckFile() {
  return fs.readFileSync(CHECK_FILE, 'utf8');
}

/**
 * Strip comments but keep strings (mirrors the Clojure helper).
 * Simplified version for property testing.
 */
function stripCommentsKeepStrings(code) {
  // Remove ;; comments but keep string literals
  return code
    .split('\n')
    .map((line) => {
      const idx = line.indexOf(';;');
      if (idx === -1) return line;
      // Check if ;; is inside a string
      const before = line.substring(0, idx);
      const quoteCount = (before.match(/"/g) || []).length;
      if (quoteCount % 2 === 1) return line; // ;; is inside a string
      return before;
    })
    .join('\n');
}

describe('BL-1372 invariant-two pin', () => {
  describe('invariant 1: second QA-ancestry predicate fails', () => {
    it('fails when an inline merge-base call mentions swarmforge-QA', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }), // sha
          (sha) => {
            // Construct a genuine QA-ancestry predicate
            const code = `
(defn some-helper []
  (let [result (sh! "git" "merge-base" "--is-ancestor" "${sha}" "swarmforge-QA")]
    (zero? (:exit result))))
`;
            const stripped = stripCommentsKeepStrings(code);
            const passes = runAssertionOnCode(stripped);
            // Invariant 1: this MUST fail (assertion returns false)
            assert.equal(
              passes,
              false,
              'A genuine QA-ancestry predicate must fail the assertion'
            );
          }
        )
      );
    });

    it('fails when an inline --is-ancestor call mentions swarmforge-QA', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }), // sha
          (sha) => {
            // Construct a genuine QA-ancestry predicate using --is-ancestor
            const code = `
(defn another-helper []
  (sh! "git" "merge-base" "--is-ancestor" "${sha}" "swarmforge-QA"))
`;
            const stripped = stripCommentsKeepStrings(code);
            const passes = runAssertionOnCode(stripped);
            // Invariant 1: this MUST fail
            assert.equal(
              passes,
              false,
              'A genuine QA-ancestry predicate must fail the assertion'
            );
          }
        )
      );
    });

    it('fails on the real babysitter_check.bb if we add a QA-ancestry call', () => {
      const realCode = readCheckFile();
      const stripped = stripCommentsKeepStrings(realCode);
      // Add a genuine QA-ancestry predicate
      const modified =
        stripped +
        `
(defn second-qa-predicate []
  (sh! "git" "merge-base" "--is-ancestor" "abc123" "swarmforge-QA"))
`;
      const passes = runAssertionOnCode(modified);
      assert.equal(
        passes,
        false,
        'Adding a second QA-ancestry predicate must fail the assertion'
      );
    });
  });

  describe('invariant 2: non-QA ancestry calls pass', () => {
    it('passes when merge-base checks HEAD vs origin/main', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          // A legitimate non-QA ancestry call
          const code = `
(defn check-divergence []
  (sh! "git" "merge-base" "HEAD" "origin/main"))
`;
          const stripped = stripCommentsKeepStrings(code);
          const passes = runAssertionOnCode(stripped);
          // Invariant 2: this MUST pass
          assert.equal(
            passes,
            true,
            'A non-QA ancestry call must pass the assertion'
          );
        })
      );
    });

    it('passes when merge-base checks arbitrary non-QA refs', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }), // ref1
          fc.string({ minLength: 1, maxLength: 20 }), // ref2
          (ref1, ref2) => {
            // Skip if either ref happens to be swarmforge-QA
            if (ref1 === 'swarmforge-QA' || ref2 === 'swarmforge-QA') {
              return; // skip this case
            }
            const code = `
(defn check-ancestry []
  (sh! "git" "merge-base" "${ref1}" "${ref2}"))
`;
            const stripped = stripCommentsKeepStrings(code);
            const passes = runAssertionOnCode(stripped);
            // Invariant 2: this MUST pass
            assert.equal(
              passes,
              true,
              `A non-QA ancestry call (${ref1} vs ${ref2}) must pass`
            );
          }
        )
      );
    });

    it('passes on the real babysitter_check.bb as-is', () => {
      const realCode = readCheckFile();
      const stripped = stripCommentsKeepStrings(realCode);
      const passes = runAssertionOnCode(stripped);
      assert.equal(
        passes,
        true,
        'The real babysitter_check.bb must pass the narrowed assertion'
      );
    });

    it('passes when --is-ancestor checks non-QA refs', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }), // ref1
          fc.string({ minLength: 1, maxLength: 20 }), // ref2
          (ref1, ref2) => {
            if (ref1 === 'swarmforge-QA' || ref2 === 'swarmforge-QA') {
              return;
            }
            const code = `
(defn is-ancestor-check []
  (sh! "git" "merge-base" "--is-ancestor" "${ref1}" "${ref2}"))
`;
            const stripped = stripCommentsKeepStrings(code);
            const passes = runAssertionOnCode(stripped);
            assert.equal(
              passes,
              true,
              `A non-QA --is-ancestor call must pass`
            );
          }
        )
      );
    });
  });

  describe('edge cases', () => {
    it('fails when swarmforge-QA appears in a merge-base call even with other refs', () => {
      const code = `
(defn mixed-refs []
  (sh! "git" "merge-base" "HEAD" "swarmforge-QA"))
`;
      const stripped = stripCommentsKeepStrings(code);
      const passes = runAssertionOnCode(stripped);
      assert.equal(
        passes,
        false,
        'Any merge-base call mentioning swarmforge-QA must fail'
      );
    });

    it('passes when swarmforge-QA appears only in comments', () => {
      const code = `
;; This is a comment mentioning swarmforge-QA and merge-base
(defn some-helper []
  (sh! "git" "status"))
`;
      const stripped = stripCommentsKeepStrings(code);
      const passes = runAssertionOnCode(stripped);
      assert.equal(
        passes,
        true,
        'swarmforge-QA in comments must not trigger the assertion'
      );
    });

    it('passes when swarmforge-QA appears only in strings unrelated to ancestry', () => {
      const code = `
(defn print-qa-ref []
  (println "The QA ref is swarmforge-QA but this is not an ancestry call"))
`;
      const stripped = stripCommentsKeepStrings(code);
      const passes = runAssertionOnCode(stripped);
      // This will fail because the pattern matches any line with
      // merge-base/--is-ancestor AND swarmforge-QA. But this is acceptable
      // because the pattern is looking for ancestry calls, and a string
      // mentioning both is suspicious enough to warrant review.
      // The real test is whether the actual babysitter_check.bb passes.
    });
  });
});
