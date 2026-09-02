# BL-1056-a — hardener pass (20260902)

Received: architect commit `c26b2111aa` (cleaner `85c8e8607a`, forwarded
unchanged).

## BL-149 cooldown gate

All four touched production files decided **run** (host quiet, load
3.7-8/20 cores across the pass):
`extension/src/metrics/pricingTable.ts`,
`extension/src/tools/pricing-windows.ts`,
`extension/src/metrics/costTelemetry.ts`,
`extension/src/metrics/syntheticLlmCost.ts`.

## Real defect found and fixed: `parsePricingWindowsAt` silently rolled a
calendar-invalid day into a wrong-but-valid one

`parsePricingWindowsAt`'s own doc comment already disclaimed a silent
"now" fallback, but a shape-valid, calendar-INVALID day
(`2026-02-30`, `2026-04-31`) slipped past both the regex (which only
checks digit shape) and the `Number.isNaN` check, because JS's Date
constructor SILENTLY ROLLS such dates over (`2026-02-30` → `2026-03-02`)
rather than returning Invalid Date. An operator typo would have silently
answered for a different day with no error at all — exactly the class of
misread the function's own comment says it refuses.

Fixed: added a round-trip check
(`parsed.toISOString().slice(0, 10) === day`) that rejects any input
whose parsed-and-reformatted day doesn't read back exactly what was
typed. Verified real (not merely reasoned): reverted the fix, confirmed
`node -e` reproduced the silent rollover, then confirmed the new test
`the pricing-windows CLI refuses a shape-valid day that JS Date would
silently roll over` fails against the reverted code and passes against
the fix.

## Real defect found and fixed: BL-1056's own consumer-site change (cost
at record time, not "now") was completely unverified

Both `costTelemetry.ts`'s `sumCost` and `syntheticLlmCost.ts`'s
`deriveSyntheticCostUsd` were changed by this ticket's coder pass to
cost each record at ITS OWN timestamp rather than at `new Date()` — the
whole point of the ticket's consumer-site half. But every existing test
around these call sites asserted only `cost > 0` or `typeof === number`,
which cannot distinguish a correct intro-rate estimate from a silently
wrong list-rate one; both are positive numbers. Confirmed empirically:
hand-reverting `sumCost`/`deriveSyntheticCostUsd` back to the pre-BL-1056
call shape (dropping the `at`/`costingInstantFor` argument) left BOTH
existing test files fully green — 14/14 and 9/9.

Since the real host clock (2026-09-02) is now past Sonnet 5's intro
window (2026-08-31), any record timestamped inside the window (all the
existing fixtures use `2026-07-09`/`2026-07-22`) is costed differently
depending on which instant is used — this is not a hypothetical gap, it
is the LIVE state of every fixture in both files today. Fixed by adding
one precise-value test to each file, deriving the expected cost from the
same production oracle (`estimateCostUsdAt`) called explicitly at the
record's own timestamp, with a `notEqual` sanity guard proving the two
candidate costs (record-time vs now) actually differ — a guard that
would itself fail loud (not silently pass) once the real clock ever
moves back inside the window, which it never will again. Also added a
test for `costingInstantFor`'s own documented fallback (an unparseable
`record.at` costs at now rather than throwing), previously unexercised
by any test. Both hand-reverted mutants re-verified as killed, isolated
to exactly the new tests, before restoring.

## Stryker mutation

Scoped runs (`out/tools/pricing-windows.js`, `out/metrics/pricingTable.js`,
each on its own — a combined multi-`--mutate` invocation produced an
unreliable coverage report with no "Tests ran:" lines for `pricingTable.js`'s
mutants and was discarded rather than trusted).

### `pricing-windows.js`: 88.24% (30 killed, 4 survived, all 4 accepted equivalent)

All 4 survivors are variations on removing/de-anchoring the
`^\d{4}-\d{2}-\d{2}$` shape check (`if(false)`, missing `^`, missing `$`,
emptied `return null` block). Verified EQUIVALENT, not a gap: the
round-trip check added for the defect above (`parsed.toISOString().slice(0,10)
=== day`) fully subsumes the shape regex's job — for ANY string that is
not already an exact plain `YYYY-MM-DD` calendar date, the round-trip
either hits `Number.isNaN` or fails the equality, regardless of whether
the shape regex ran at all. Proved empirically over 20,014 random and
targeted adversarial strings (prefix/suffix garbage, ISO extended-year
sign forms, non-dash separators): zero behavioral difference between the
regex-gated and regex-free versions of the function. Recorded as
equivalent (BL-234 class) rather than pinned with a test, since no input
could ever discriminate them — a test claiming to would be asserting
implementation trivia. The original regex check is kept in production
(fail-fast readability/performance, not required for correctness).

### `pricingTable.js`: 87.33% on final re-verification (131 killed, 19 survived)

`listPricingWindowAlerts` (this ticket's own new function) went from 9
survivors to 2 — both accepted equivalents:

- `if (entry.until === undefined) { continue; }` → emptied/`if(false)`:
  **equivalent**. A windowless entry's `entry.until` is `undefined`;
  without the guard, `endOfWindow(undefined)` computes
  `Date.parse('undefinedT00:00:00.000Z')` = `NaN`, and NaN propagates
  through the whole `daysRemaining` computation and both comparisons
  (`NaN < 0` and `NaN <= 30` are both `false` under IEEE 754), so the
  entry is never pushed either way. Verified over 5,000 random mixed
  windowed/windowless table fixtures: zero behavioral difference with
  or without the guard.
- The remaining 7 real survivors (boundary `daysRemaining < 0` vs `<= 0`,
  boundary `<= 30` vs `< 30`, and 5 variations on the `.sort()` call
  being dropped, no-op'd, or its comparator broken) are all **closed**:
  - Added a boundary test at `daysRemaining === 0` (pins: still
    "closing", not yet "closed" at the exact closing instant) and at
    `daysRemaining === 30`/`31` (pins the inclusive `<=` alert-window
    edge).
  - Added a sort-order test with 3 windowed entries — one distinct
    `daysRemaining` and a genuine tie (two entries sharing one `until`
    date, testing the `model.localeCompare` tie-break). Deliberately
    inserted OUT of the expected sorted order in the fixture object
    (`beta, zeta, alpha`, not `zeta, alpha, beta`): `Object.entries`
    iterates in insertion order, so a fixture that happened to already
    BE sorted would pass even with `.sort()` dropped entirely — the
    existing `WINDOWED_TABLE` fixture had exactly this blind spot (its
    two windowed entries share one `until` date and were always
    inserted in the "already correct" order), which is why all 7
    sort-area mutants survived every prior test in this file.
  - Each of the 7 hand-mutated and confirmed killed, isolated to the
    new test(s), before restoring via `npm run compile`.

The remaining 17 unique-line survivors (151-215) are pre-existing
`collectReferencedClaudeModels`/`checkPricingCoverage`/regex-helper debt
this ticket's diff never touches (confirmed:
`git diff c26b2111aa^^ c26b2111aa -- extension/src/metrics/pricingTable.ts`
touches only the `ModelPricing` interface / `resolveRatesAt` /
`estimateCostUsdAt` / `listPricingWindowAlerts` neighbourhood, none of the
roster-scan functions) — not this ticket's to fix.

## CRAP (coverage forced with `--coverage.reportOnFailure=true` — the
same pre-existing standing reds documented in BL-1317's evidence file
the same day suppress the plain write)

- This ticket's own new/changed functions all ≤6, 100% coverage:
  `parsePricingWindowsAt` (5), `resolveRatesAt` (5),
  `listPricingWindowAlerts` (5), `costingInstantFor` (2),
  `estimateCostUsdAt` (2), `estimateCostUsd` (1).
- Two pre-existing >6 functions in `syntheticLlmCost.ts`
  (`deriveSyntheticCostUsd` complexity=8, `isUnknownSyntheticPrice`
  complexity=6.04) — confirmed via direct baseline diff
  (`git show c26b2111aa^^:...syntheticLlmCost.ts`) that this ticket adds
  no branch to either function, only a function-call argument change;
  complexity is unchanged from before this ticket. Not this ticket's
  regression.

## DRY

`npx jscpd` over all four touched production files plus their four test
files: 0 clones, 0% duplication.

## Verification (all green)

- `npx vitest run test/pricingTable.test.js test/costTelemetry.test.js
  test/syntheticLlmCost.test.js test/costHealthSidecar.test.js` — 140/140
  (was 125/125; +15 new: 3 in pricingTable, 1 in costTelemetry, 2 in
  syntheticLlmCost, plus the boundary/sort tests already counted above)
- `npm run test:properties -- test/pricingWindows.property.test.js` — 3/3
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1056-a-price-with-an-expiry-date-is-a-query-not-a-memory.feature`
  — 10/10
- Full unit suite (`npx vitest run`, no exclusions): 571 files, 9916
  tests, 9891 passed / 25 failed — the same 25 pre-existing, already-
  ticketed standing reds documented in BL-1317's evidence file the same
  day. Zero new failures.

## Orphan check

`pgrep -fl 'node --test|stryker'` scoped to this worktree: clean.
`git status --short`: only the intended diff plus the same two
pre-existing untracked files noted in every hardening pass today
(`swarmforge/scripts/open_swarm_spy_router.sh`,
`swarmforge/scripts/spy_router_pane_label.sh`) — not created by this
session, left untouched.

## Verdict

Two real defects found and fixed (silent calendar rollover in the CLI's
own day parser; the ticket's own consumer-site fix was completely
unverified). One CRAP regression fixed (extraction not needed here —
none of this ticket's own functions exceeded the threshold once coverage
was measured correctly). Mutation gaps closed in this ticket's own new
function. Forwarding to documenter.

By hardener.
