# Unowned red: multiBranchParserCoverageCheck reports false coverage via substring containment

Found while verifying BL-1662 (unrelated: BL-1662 touches only
`check_merge_deletion.sh`, BL-1242's feature/handler, and the fixture
CLI; this file is not in its diff). Confirmed real and deterministic —
NOT a host-load flake, unlike two other property-test sightings this
same lane run (`unowned-red-bl1630-module-load-budget-timing-flake-20260920.md`).

## What fast-check found

`test/multiBranchParserCoverageCheck.property.test.js`, "any missing arm
marker among ≥3 arms yields a miss": counterexample `["c--a","a00","c--"]`
(arm a="c--a", arm b="a00", arm c="c--"; `testTexts: [a, b]`, c
deliberately excluded). Expected: `result.miss` names arm `c` as
untested. Observed: `result.miss` is `undefined` — the checker reports
full coverage.

## Direct reproduction (no test framework, confirms it's real)

```js
const { assessMultiBranchParserCoverage } = require('./out/tools/multiBranchParserCoverageCheck');
assessMultiBranchParserCoverage({
  parsers: [{ functionName: 'parse-flow', sourcePath: 'lib/parse.ts',
    arms: [{ label: 'c--a', marker: 'c--a' }, { label: 'a00', marker: 'a00' }, { label: 'c--', marker: 'c--' }] }],
  testTexts: ['c--a', 'a00'],
});
// => { checked: true, parsersScanned: 1 }  -- no `miss` key at all
```

## Root cause

`extension/src/tools/multiBranchParserCoverageCheck.ts:40`:

```ts
return testTexts.some((text) => text.includes(arm.marker));
```

`String.includes` is substring containment, not whole-token/exact
matching. Arm `c`'s marker (`"c--"`) is a literal PREFIX SUBSTRING of arm
`a`'s own text (`"c--a"`), so checking `"c--a".includes("c--")` returns
`true` and the checker concludes arm `c`'s marker was exercised by a test
text that was never actually testing arm `c` at all — a false-positive
coverage claim.

## Why this matters

This function backs BL-755's pilot-acceptance landing gate
(`extension/src/tools/pilotAcceptanceGate.ts`, `landPilotedTicket`):
its entire purpose is refusing to land a multi-branch parser change when
any branch/arm is untested. A false-positive here means a genuinely
untested parser arm can be silently reported as covered whenever its
marker string happens to be a substring of another arm's marker or of
unrelated test text — exactly the shape this gate exists to catch. Real
arm markers are often short keywords/literals, so this is not a
contrived edge case.

## Disposition

No standing-red register row or ticket found (grepped before writing
this). Not BL-1662's defect — confirmed the file and its dependency
(`pilotAcceptanceGateDeps.js`) are absent from BL-1662's diff, and the
bug reproduces identically against `origin/main`'s copy of the compiled
tool. Reporting as a genuine, deterministic, unowned production defect
for the specifier to mint — recommend anchoring the containment check on
arm/word boundaries (e.g. a regex with `\b` or matching the marker as
its own generated token) rather than raw substring `includes`.

By QA.
