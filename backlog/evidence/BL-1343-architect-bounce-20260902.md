# BL-1343 — architect bounce, 2026-09-02

Reviewed commit `8916d5cef8` (coder), forwarded unchanged by cleaner
(`ffebc5967d`, "cleaner pass — NONE, no defect found").

## Review inventory (complete pass, Article 4.4)

- `swarmforge/scripts/land_step_lib.bb` diff read against the ticket's two
  declared invariants and the `own-paths`/`land-plan` docstrings: correct.
  `land-plan` already treats `{:paths nil ...}` as `:escalate` (line
  364-369), so the new refusal surfaces via the existing CLI path with no
  second code path, matching the commit message's claim.
- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` — ALL PASS.
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-1343-replay-drops-the-tickets-own-path.feature` — 6/6
  scenarios pass. Handler registered in `specs/pipeline/steps/index.js`
  (required_wiring satisfied).
- `node extension/out/tools/dependency-gate.js` on the touched TS test file
  — PASSED, no forbidden edges (the `.bb` file is out of the TS gate's
  scope, as expected).
- BL-1272's fail-closed sibling rule and BL-1332 untouched — confirmed by
  reading the diff: only `own-paths`'s empty-branch handling changed.

## D1 — the coder-authored property test's own coverage-floor is flaky

**Failing check**: `npx vitest run --config vitest.properties.config.mjs
test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js`, repeated.

**Commit tested**: `8916d5cef8a54e278e9a08efd8dbd2231bb169bd`.

**Observed**: failed once in 6 consecutive runs, with:
```
AssertionError: generator never reached a fully-subtracted contribution -
the defect corner went untested
```
The other 5 runs passed. This is not a production-code failure — the
message is the test's own `reach.fullySubtracted > 0` self-check
(line 177), not an assertion about `land_step_lib.bb`'s behavior.

**Root cause, computed from the generator (lines 104-128)**: `filesArb` is
`fc.array(fileArb, {minLength: 1, maxLength: 4})`, and each element
independently draws `creditedTo` uniformly from `{'sibling','own','nobody'}`
(p=1/3 each). `reach.fullySubtracted` requires EVERY commit in the array to
land on `'sibling'`. Averaging over array length 1-4 (uniform 1/4 each):

    P(fullySubtracted) = 1/4 * [(1/3) + (1/3)^2 + (1/3)^3 + (1/3)^4] ≈ 0.123

Over `numRuns: 25`, `P(never reached) = (1 - 0.123)^25 ≈ 4.6%` for this one
test. The sibling test (`invariant 2`, same file, lines 182-229) has the
same `reach.refusals` requirement over the same generator and the same
`numRuns: 25`, independently drawn — another ≈4.6%. Combined,
`P(at least one of the two tests spuriously fails) ≈ 1 - (1-0.046)^2 ≈ 9%`.
Empirical: 1/6 ≈ 17%, consistent with that estimate at this sample size.

**Failure class**: `test-reliability` (the property test itself, not the
production code, is the defect — same BL-654 authorship rests with the
coder for a new/changed `*.property.test.js`; a coverage-floor assertion
that itself has a material chance of spurious failure is the "vacuous the
other direction" case — instead of never biting, it sometimes bites for no
reason).

**Why this matters**: the file's own header comment states the opposite
intent verbatim — "a generator drawing subjects freely would reach that
corner rarely... the 'technically reachable but astronomically rare'
shape" — and then implements exactly a freely-drawn, independent-per-commit
generator for the all-`'sibling'` corner. At `numRuns: 25` this is not rare
enough to treat as reliable: it will intermittently red the hardener's and
any CI re-run of `npm run test:properties`, and an intermittent red on a
land-machinery fix is exactly the kind of noise that gets a real regression
waved through as "just the flaky one."

**Remediation pointer**: `extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js`,
`filesArb`/`toCommits` (lines 104-128) and the two `reach.*` floor
assertions (lines 177-179, 228-229). Force each corner to be reached by
construction rather than by independent per-element chance — e.g. draw an
explicit partition of the array into sibling/own/nobody groups (guaranteeing
at least one all-sibling case and one mixed case across the run), the same
discipline `pricingWindows.property.test.js` (BL-1056) already uses in this
repo (construct offsets from the boundary rather than drawing an arbitrary
instant). Owning role: **coder** — property-test authorship for a new file
rests with the coder (BL-654), and this file is new to this ticket.

## Inventory close
No other defect found. This is the only item (D1). Routing to `coder`
(the role whose deliverable this property test is).
