# BL-680 specifier-consolidation-authority — 20260801 (architect)

## Verdict: BOUNCE to coder — declared invariants only half-encoded

## What was reviewed

Merged cleaner's forward of coder commit `29574c6286` (`By coder.`) into the
architect worktree on top of QA's BL-729 merge-up. Compiled clean
(`npm run compile`), and everything that ran was green:

- `node out/tools/dependency-gate.js src/tools/intakeConsolidationCore.ts` —
  PASSED, no forbidden edges.
- `node out/tools/co-change-report.js src/tools/intakeConsolidationCore.ts` —
  only 1 co-change each with the other 6 files in this same commit; below the
  default frequency-3 threshold, no coupling flagged.
- `npx vitest run test/intakeConsolidationCore.test.js` — 10/10 pass.
- `npx vitest run --config vitest.properties.config.mjs test/intakeConsolidationCore.property.test.js`
  — 6/6 pass, all confirmed non-vacuous per the file's own header (break-then-
  fix documented for each of the three invariants).
- `./specs/pipeline/scripts/run_acceptance.sh specs/features/BL-680-specifier-consolidation-authority.feature`
  — 8/8 sub-tests pass (7 scenarios, one Outline expanding to 2).
- Cross-checked every `requireIncludes` substring in
  `bl680ConsolidationAuthoritySteps.js` against the live
  `swarmforge/roles/specifier.prompt` text by hand (lines 289-317) — all
  match exactly.

None of that is what catches the defect below — it is a gap in what the
ticket chose to encode, not a failure of what it encoded.

## The defect — invariants 1 and 3 are only encoded for the merge (N:1) path

BL-680 declares three invariants, quantified over "consolidation" as a
whole — the ticket's own prompt text frames N:1 merge and 1:N split as two
equally-authoritative forms of consolidation ("A merge **or split** that
cannot preserve one is refused"). But the pure module, its property tests,
and the Gherkin acceptance only encode invariants 1 and 3 for the merge
side. The split side (`splitIntake`/`SplitPart`/`SplitResult`) never
represents directives at all, and never represents the reverse ticket→intake
pointer.

### D1 — invariant 1 ("no consolidation drops a human sentence") unencoded for split

`SplitPart = { ticketId, mechanism }` (intakeConsolidationCore.ts:44-48) has
no `directives` field, and `splitIntake` never touches directives. Compare
`mergeIntakes`, which unions every source's `directives` into the one
resulting ticket and is covered by a property test
(`intakeConsolidationCore.property.test.js:56-85`) and Scenario 06. Nothing
— not the pure module, not a property test, not the Gherkin (Scenario 07
only asserts mechanism bijection, never directive preservation) — asserts
that when one intake is split into N tickets, every operator directive
quoted in that intake still appears verbatim in at least one of the N
resulting tickets.

Concrete failure this leaves undetected: an intake carries a shared
directive ("notify the operator before cutover") alongside three separable
mechanisms. It gets split into three mechanism tickets by
`isConsolidationTarget`'s allowed shape, and the shared directive is
attached to none of them — `splitIntake` has no way to even accept it, let
alone verify it survived. Invariant 1 is silently violated and no test in
this parcel would ever fail.

### D2 — invariant 3 ("total in both directions") only forward-encoded for split

Invariant 3's own text: "every source intake names every ticket it became,
**and every resulting ticket names every intake it came from**." For the
merge path the prompt instructs both halves explicitly — "the resulting
ticket lists every source intake" AND "each source intake archives with a
pointer to that ticket" (specifier.prompt:292-295) — and `MergedTicket`
carries `sourceIntakeIds` directly on the ticket-shaped object.

For the split path, only the forward half is instructed: "The intake
archives once, pointing at every resulting ticket, and states which part of
the intake went to which ticket" (specifier.prompt:296-300). Nothing
instructs that each *resulting ticket* itself records which intake it came
from. Structurally, `SplitPart` has no `sourceIntakeId`/back-reference field
of its own — only the wrapping `SplitResult` carries `sourceIntakeId` once,
shared across all parts. The property test
(`intakeConsolidationCore.property.test.js:128-155`) and Scenario 07 both
only check the forward direction ("the archived intake points at all
three") — never that a resulting ticket, taken on its own, names the intake
it came from.

Concrete failure: once this authority is exercised (the next intake-drain
turn, per this ticket's own deferral), a 1:N split produces ticket `BL-901`
for "turn profiler." Nothing in this parcel's data model, tests, or prompt
instruction requires `BL-901`'s own YAML to record which intake it came
from. Anyone auditing `BL-901` in isolation has no way to trace it back —
exactly the bidirectional-totality failure invariant 3 exists to prevent,
and exactly the class of bug BL-680 itself was filed to stop happening again
(the standing-topic cluster's lying `depends_on: []`).

## Suggested remediation (coder's call on the exact shape)

- Give `SplitPart` (or `splitIntake`'s output per-part) a `directives`/
  provenance field so the split path can be tested the same way the merge
  path is: every directive from the source intake must appear on at least
  one resulting part, and the property test should confirm it non-vacuously
  (break the union, watch it fail, restore).
- Give `SplitPart` its own back-reference to the source intake (or otherwise
  make explicit, and test, that each resulting ticket independently names
  the intake it came from) — not only recoverable by reading the wrapping
  `SplitResult`.
- Extend `swarmforge/roles/specifier.prompt`'s 1:N split bullet to instruct
  the reverse pointer explicitly, mirroring the two-line coverage already
  present for the merge case.
- Extend the Gherkin feature with split-side scenarios for both (mirroring
  Scenario 06's merge-side directive check and adding a ticket-names-intake
  check), and wire their step handlers in the same commit.

Both items are the same underlying gap (the split path was built to a
narrower spec than the merge path, despite the invariants applying to both)
— reported as one bounce, two `Dn` items, per Article 4.4.
