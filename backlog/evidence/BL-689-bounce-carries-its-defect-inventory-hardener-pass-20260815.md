# BL-689 hardener pass — 2026-08-15

## Scope

Received from architect as `merge_and_process architect 98a4b87048` (batch,
alongside BL-697 and BL-628). Reviewed the architect-approved commit fresh.

Files in scope: `extension/src/quality/qaBounce.ts`,
`extension/src/tools/qa-bounce-line.ts`, `extension/src/tools/record-bounce.ts`,
`extension/src/tools/recordBounceArgs.ts` and their tests, plus
`specs/features/BL-689-bounce-carries-its-defect-inventory.feature`.

## Host load (BL-149 cooldown gate / office-hours bypass)

`uptime` showed load average 7.9-70.9 across this pass (4 cores) — well over
the 2x-cores busy threshold throughout. `mutation_cooldown_gate.bb` on all 4
changed production files returned `DECISION: skip-busy` for each. Per the
office-hours mutation bypass policy, Stryker mutation is deferred to the next
quiet pass; this pass hardens via targeted-test re-verification, CRAP, DRY,
and BL-113 Gherkin acceptance mutation instead, and forwards now rather than
stalling the pipeline.

## Tests re-run independently (all green)

- `npx vitest run test/qaBounce.test.js test/bounceStore.test.js test/qaBounceLineCli.test.js test/recordBounceCli.test.js` → 4 files, 119/119 passed.
- `npx vitest run --config vitest.properties.config.mjs bl689` → 6/6 passed (3 invariant properties + 3 non-vacuity companions).
- `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-689-bounce-carries-its-defect-inventory.feature` → 10/10 scenarios PASS.
- `npx vitest run --coverage qaBounce bounceStore recordBounce qa-bounce-line` (targeted coverage set) → 9 files, 204/204 passed.

## CRAP (`npm run crap`, scoped to the 4 changed `src/*.ts` files)

Initial run flagged one violation:

- `src/quality/qaBounce.ts::isValidBounceInventoryItem` — complexity=10,
  coverage=100%, **CRAP=10.00** (> 6 threshold). Coverage was already
  complete; the violation was pure cyclomatic complexity from one long
  `&&`-chained boolean expression covering 4 fields (id, class, blamed,
  pointer), each with its own type + membership check.

**Fix (behavior-preserving split, hardener-owned per "make behavior-preserving
splits so code is testable"):** extracted three small predicates —
`isNonEmptyString`, `isKnownFailureClassValue`, `isKnownProducingRoleValue` —
and composed them in `isValidBounceInventoryItem`, cutting it from an 8-clause
chain to a 4-clause chain. Re-ran `npm run crap`: **0 functions exceed CRAP 6**
(exit 0). Re-ran the full targeted test set above after the change (recompiled
first) — all still green, confirming the split is behavior-preserving.

## DRY (`npx jscpd --config .jscpd.json src`)

35 pre-existing clones reported project-wide, none touching any of this
ticket's 4 changed files (`qaBounce.ts`, `qa-bounce-line.ts`,
`record-bounce.ts`, `recordBounceArgs.ts`) — all clones are in unrelated
Telegram-bridge modules. Nothing to reduce for this parcel.

## BL-113 Gherkin acceptance mutation (soft)

`specs/pipeline/scripts/run_gherkin_mutation.sh specs/features/BL-689-bounce-carries-its-defect-inventory.feature . specs/pipeline/steps/index.js soft`

Result: **Total 12, Killed 7, Survived 5, Errors 0**.

All 5 survivors reviewed and confirmed **equivalent mutants** (BL-234) — each
demonstrably indistinguishable from the code, not a convenience call:

- **m1** (`scenarios[0].examples[0].blocked: 0 -> 6`) and **m3**
  (`scenarios[0].examples[1].blocked: 3 -> 10`): Scenario Outline
  `bounce-carries-its-defect-inventory-01` uses the same `<blocked>`
  placeholder to both DRIVE the recording call and to state the expected
  value in the following assertion step (confirmed in
  `bl689BounceCarriesDefectInventorySteps.js` lines 102-107 and 132-141: the
  assertion step does check `record.blocked !== Number(blocked)` — it is not
  a missing assertion). `resolveBlockedCount` (recordBounceArgs.ts) accepts
  any non-negative integer with no relationship to the items count or any
  other field (verified by reading the function). So any two valid digit
  values in this placeholder position round-trip identically — no example
  value in this position could ever be distinguished by the test. Not a gap.
- **m5** (`scenarios[3].examples[0].inventory: {not json -> xnot json`): both
  the original and mutated strings are syntactically invalid JSON;
  `resolveBounceInventory` catches any `JSON.parse` failure identically and
  reports `unparseable` regardless of which invalid string was given.
  Equivalent by construction.
- **m9** (`scenarios[3].examples[2]`, `blamed: coder -> coDer`): this row's
  item is `{"id":"D1","class":"flaky","blamed":"coder"}` — `class: "flaky"`
  is not in `KNOWN_FAILURE_CLASSES`, so `isValidBounceInventoryItem` already
  returns false via the `class` check before `blamed` is ever evaluated
  (confirmed: the `&&` chain short-circuits). Mutating `blamed`'s casing
  cannot change this row's outcome.
- **m11** (`scenarios[3].examples[3]`, JSON key `blamed` -> `blameD`): this
  row's item is `{"id":"D1","class":"unit","blamed":"operator"}` —
  `class: "unit"` IS valid, so validity here hinges on `blamed`.
  `"operator"` is not in `KNOWN_PRODUCING_ROLES`, so `isKnownProducingRoleValue`
  returns false before mutation. After the key-rename mutation, `blamed` is
  simply absent (`undefined`), which also fails the same `typeof value ===
  'string'` guard. Both paths produce `isValidBounceInventoryItem === false`
  and the same `invalid-item` degrade reason — the code deliberately does not
  (and should not) distinguish "field missing" from "field present but
  invalid" for this purpose.

No non-equivalent survivor found. Nothing further to kill.

## Verdict

CRAP violation found and fixed (behavior-preserving split, all tests still
green). DRY clean for this parcel's files. BL-113 acceptance mutation run
complete; all 5 survivors reviewed and confirmed equivalent, none require a
new/sharpened test. Stryker mutation deferred to the next quiet pass per the
office-hours bypass policy (host busy throughout: cooldown gate returned
`skip-busy` for every changed file). Forwarding to documenter.

By hardender.
