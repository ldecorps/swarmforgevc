# Unowned red: bl1372InvariantTwoPin.property.test.js quote-parity bug

Found during BL-1656's own required property-lane run (`npm run
test:properties`), unrelated to that parcel's diff (BL-1656 touches only
`bl1368ApprovalCommitByline.property.test.js`).

## Failing command

```
cd extension && npx vitest run --config vitest.properties.config.mjs test/bl1372InvariantTwoPin.property.test.js
```

Full-suite run (2026-09-20T02:39Z window): `BL-1372 invariant-two pin >
invariant 1: second QA-ancestry predicate fails > fails when an inline
--is-ancestor call mentions swarmforge-QA` failed:

```
Error: Property failed after 100 tests
{ seed: 287158657, path: "99:2:19:16", endOnFailure: true }
Counterexample: ["\";; "]

AssertionError: A genuine QA-ancestry predicate must fail the assertion
false !== true
```

Isolated re-runs of the whole file (3/3, no seed pinned) pass clean - NOT
a host-load flake (see below for a deterministic, seedless repro).

## Root cause (verified deterministically, no fast-check involved)

`stripCommentsKeepStrings` (test/bl1372InvariantTwoPin.property.test.js:72-86)
decides whether a `;;` on a line is "inside a string" by counting `"`
characters before it and checking parity (odd = inside a string, even =
strip from `;;` on). This assumes the property's generated `sha` fixture
value, interpolated as `"${sha}"` in the generated Clojure snippet,
contributes exactly the two `"` delimiters already in the template and
nothing else. The generator (`fc.string({minLength: 1, maxLength: 20})`)
is unconstrained and can produce a `sha` that itself contains a `"` -
breaking that assumption.

Direct repro (`node -e`, no fast-check, no vitest):

```js
const sha = "\";; ";  // fast-check's own counterexample
const code = `
(defn another-helper []
  (sh! "git" "merge-base" "--is-ancestor" "${sha}" "swarmforge-QA"))
`;
// generated code: `(sh! "git" "merge-base" "--is-ancestor" "";; " "swarmforge-QA"))`
// stripCommentsKeepStrings sees 8 `"` before the `;;` (even) -> strips
// from `;;` on, DELETING "swarmforge-QA" along with it.
// stripped:        `(sh! "git" "merge-base" "--is-ancestor" ""`
// runAssertionOnCode(stripped) -> NARROWED_PATTERN no longer matches
// (swarmforge-QA is gone) -> returns true ("passes"), but the test
// asserts this must be false ("a genuine QA-ancestry predicate must
// fail"). Reproduces 100% of the time for this exact sha, no seed
// needed.
```

This is a bug in the TEST'S OWN fixture-construction helper
(`stripCommentsKeepStrings`, a JS re-implementation of a Clojure comment
stripper for property-testing purposes), not in the production code under
test (`bl962_merge_adjudication_test_runner.bb`'s real `NARROWED_PATTERN`
assertion, which BL-1372 itself already fixed and pinned) - the generator
can construct a `sha` that corrupts the SYNTACTIC validity of the snippet
it is embedded in, invalidating the fixture for that draw rather than
exercising a real production defect.

## Status

Not owned by any ticket in `backlog/standing-reds.tsv` or
`backlog/active|paused` as of this sighting. Reported per the standing-red
rule (2026-09-05 amendment) rather than fixed here - out of scope for
BL-1656 (which touches only bl1368's own file) and for the coder acting
alone without a minted ticket.
