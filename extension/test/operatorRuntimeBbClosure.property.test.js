const assert = require('node:assert/strict');
const fc = require('fast-check');
const { directLoadFileDeps } = require('../../specs/pipeline/steps/lib/operatorRuntimeBbClosure');

// BL-944 (architect Property Testing pass): directLoadFileDeps is a pure,
// touched, parsing-shaped function this ticket introduced (extracts every
// `.bb` filename a Babashka source load-files, via a targeted regex over
// the one consistent `(load-file (str ... "NAME.bb"))` idiom this codebase
// uses) with only two narrow hand-picked examples of its own (one hit, one
// miss) - a textbook parsing-stability candidate the architect role prompt
// names explicitly. computeClosure/diffClosureAgainstList are deliberately
// NOT targeted here: both do real fs reads, the same impure boundary this
// role excludes from property coverage (never the fixture/IO layer).
// Runs ONLY via `npm run test:properties`; excluded from unit/coverage/
// mutation.
//
// Property: source text built from N real load-file forms (the exact idiom
// every .bb file in this repo uses), each naming a distinct random `.bb`
// filename, interleaved with noise lines that contain neither "load-file"
// nor a quoted ".bb" string, round-trips through directLoadFileDeps to
// exactly that list of filenames, in order - across a wide generated space
// of filenames and interleavings, not just the one real name
// (mono_router_lib.bb) the module's own required_wiring anchor pins.
//
// Non-vacuity, checked by hand before landing: changed LOAD_FILE_RE's
// character class from `[^"]+\.bb` to `[^"]+\.clj` (a plausible near-miss
// typo for this codebase, which also has .clj-adjacent tooling) - the
// round-trip property failed immediately (empty extraction against
// generated names), and the "finds nothing" property below did NOT catch
// it (a regex that matches too NARROWLY still correctly returns nothing on
// pure noise), confirming the two properties below catch complementary
// failure directions. Reverted and reconfirmed green.

const BB_NAME = fc
  .stringMatching(/^[a-z][a-z0-9_]{1,24}$/)
  .map((s) => `${s}.bb`);

const NOISE_LINES = [
  '; a plain Babashka comment, no load-file here',
  '(defn helper [] (+ 1 1))',
  '(require (quote clojure.string))',
];

function formatLoadFile(name) {
  return `(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "${name}")))`;
}

function buildSource(names) {
  return names
    .map((name, idx) => `${NOISE_LINES[idx % NOISE_LINES.length]}\n${formatLoadFile(name)}`)
    .join('\n\n');
}

test('property: directLoadFileDeps round-trips a list of load-file targets through comment/code noise, in order', () => {
  fc.assert(
    fc.property(fc.uniqueArray(BB_NAME, { minLength: 1, maxLength: 10 }), (names) => {
      const source = buildSource(names);
      assert.deepEqual(directLoadFileDeps(source), names);
    }),
    { numRuns: 200 }
  );
});

test('property: text with no load-file form never yields a dependency', () => {
  fc.assert(
    fc.property(fc.array(fc.constantFrom(...NOISE_LINES), { minLength: 0, maxLength: 10 }), (lines) => {
      assert.deepEqual(directLoadFileDeps(lines.join('\n')), []);
    }),
    { numRuns: 100 }
  );
});
