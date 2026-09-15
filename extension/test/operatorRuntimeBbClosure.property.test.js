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

// BL-1569: a load-file form may name one or more DIRECTORY segments before
// the final .bb name - (fs/path (fs/parent ...) "test" "x.bb") means
// test/x.bb, not the bare last segment. This is the shape
// unregistered_test_gate_lib.bb's real form has (BL-1569 invariant 1/2).
const PATH_SEGMENT = fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/);
const MULTI_SEGMENT_DEP = fc
  .tuple(fc.array(PATH_SEGMENT, { minLength: 1, maxLength: 3 }), BB_NAME)
  .map(([dirs, name]) => [...dirs, name].join('/'));

const NOISE_LINES = [
  '; a plain Babashka comment, no load-file here',
  '(defn helper [] (+ 1 1))',
  '(require (quote clojure.string))',
];

function formatLoadFile(name) {
  const segments = name.split('/');
  const quoted = segments.map((s) => `"${s}"`).join(' ');
  return `(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ${quoted})))`;
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

// BL-1569 declared invariant 1/2 (coder-authored): a load-file form naming
// several path segments round-trips through directLoadFileDeps as the
// directory-qualified path, never the bare last segment - across a
// generated space of segment counts and names, not just the one real
// two-segment case (unregistered_test_gate_lib.bb's "test" "suite_
// inventory_lib.bb") this ticket fixes.
//
// Non-vacuity, checked by hand before landing: reverted to capturing only
// the LAST quoted segment (this ticket's actual prior bug) - the property
// failed immediately whenever a generated dep had more than one segment,
// confirming it exercises the exact regression this ticket closes. Restored
// and reconfirmed green.
test('property: directLoadFileDeps round-trips a multi-segment load-file target as its directory-qualified path', () => {
  fc.assert(
    fc.property(fc.uniqueArray(MULTI_SEGMENT_DEP, { minLength: 1, maxLength: 6 }), (deps) => {
      const source = buildSource(deps);
      assert.deepEqual(directLoadFileDeps(source), deps);
    }),
    { numRuns: 200 }
  );
});
