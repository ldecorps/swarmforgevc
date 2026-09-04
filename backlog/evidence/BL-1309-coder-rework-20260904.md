# BL-1309 — CODER REWORK to the REVISED ruling, 2026-09-04

Supersedes `BL-1309-coder-20260903.md`, which built ruling option 1. That pass
was correct for the ruling it had. The ruling has since changed.

## Why this pass exists

`human_ruling:` on this ticket now carries a REVISION, recorded by BL-1375:

> REVISED 2026-09-03 via BL-1375: this option deadlocked the land queue when
> N approved tickets share one path (four did, immediately). The human
> narrowed the refusal to option 2 — refuse only when the entangled sibling
> is withheld or awaiting approval — superseding the "refuse every entangled
> tip" choice above.

The option-1 code was QA-approved (`522584ed85`) but never landed
(`BL-1309-land-escalate-20260903.md`), so nothing shipped under the superseded
ruling and there is no revert to do — only a rebuild to the ruling that stands.

## What changed

`swarmforge/scripts/land_main_publish.sh` — the guard now asks WHICH sibling
blocks instead of refusing on the bare fact of entanglement. It calls
`land_step_lib.bb`'s `blocking-siblings`, the predicate BL-1375 built and that
`land-plan` already decides on, so the mandatory decide step and the hand-run
`land_step_cli.bb` cannot give different answers about the same tip. The
refusal now prints each blocker's state and reason, not just its id: "held",
"unapproved" and "unreadable" have three different remedies.

Fail-open is unchanged and re-verified (invariant 2): no tip sha, no detector
on disk, a tip whose subject names no ticket, an unreadable range, or a
detector that crashes all still print the ordinary decision. Note the two
absences are deliberately NOT symmetrical, and the distinction is the whole
safety argument: the step failing to run its OWN check fails open; a SIBLING
whose approval cannot be read fails closed (BL-1375 invariant 1 — absence
never buys a ride).

## Verification

- `swarmforge/scripts/test/land_main_publish_test_runner.sh` — 12/12 PASS.
  Rows 04/04b/04c/04d hold the git shape byte-identical and vary only the
  sibling's backlog file, so the narrowing is measured, not described:
  unreadable → refuse, approved → proceed, hold → refuse, pending → refuse.
- **Non-vacuity of the narrowing, proved directly rather than argued**: the
  pre-change script (`git show HEAD:…land_main_publish.sh`, run from the real
  scripts dir so its libs resolve) REFUSES the 04b fixture with
  `ENTANGLED_SIBLING_BLOCK` / exit 3; the shipped one prints the ordinary
  decision on that same fixture.
- `specs/features/BL-1309-…feature` — 10/10 via `run_acceptance.sh`. Two new
  rows pair the merge route with an approved sibling and with a held one, so
  the 2026-08-31 shape and the deadlock shape differ by exactly one file.
- `npx vitest run --config vitest.properties.config.mjs
  bl1309LandDecideEntanglementInvariants` — 3/3. Invariant 1 is now crossed:
  every blocking state (held, pending, unreadable) × every route (plain
  commit, second-parent merge, rematch), plus a second property that an
  APPROVED sibling rides by every route. The riding property asserts its own
  non-vacuity first — the same tip refuses before the ticket file is written.
- `swarmforge/scripts/test/bl1309_entanglement_mutation_sweep.sh` — killed=9
  survived=0 equivalent=2. Three mutants added for the new predicate; the
  first of them restores option 1 exactly (refuse every entangled tip) and is
  killed, so the superseded behaviour cannot creep back unnoticed.
- `swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.

## TWO SPEC GAPS raised to the specifier, not worked around (priority-00 note)

Neither is mine to edit, and neither blocks the code:

1. **`invariants:` entry 1 still carries the pre-revision wording** — "No tip
   that adds an unlanded ticket's content over origin/main is advised for
   push". Under the ruling that now stands, an APPROVED unlanded sibling IS
   advised. The property test encodes the ruling and says so in its header
   rather than silently encoding either version.
2. **`required_wiring` entry 2 is unsatisfiable since BL-1371 landed.** It
   cites `specs/pipeline/steps/index.js::bl1309LandDecideStepEntanglementSteps`,
   but BL-1371 replaced the hand-maintained `DOMAINS` array with file
   discovery, so no handler name appears in that file at all
   (`grep -c` → 0) and `pre_qa_gate_lib.bb`'s wiring check will report it
   missing. The anchor's PURPOSE — pinning the draft→live promotion so the
   rename cannot be forgotten — was already satisfied on 2026-09-03 and holds:
   the live `.feature` exists and `acceptance:` points at it. Only the anchor's
   address is stale. This affects every ticket minted before BL-1371 that
   carries the same shape, not just this one.

## Merge lineage

`origin/main` (`af54d6134f`) merged in first (`69997cf5ca`). The merge subject
names no ticket, per standing practice; `check_merge_deletion.sh` needed
BL-1309 named for the `.feature.draft` removal, so it is in the BODY only —
that deletion is this branch's own draft→live promotion, not lost coverage.
The index.js conflict was resolved in favour of main's discovery registry.

By coder.

## ADDENDUM — the narrowing measured on the REAL tip, not only on fixtures

`qa_e2e_procedure` step 4 asks for the live path. Run against this branch's own
tip (`aba92d6998`), which carries 36 distinct ticket ids over `origin/main`:

    bash swarmforge/scripts/land_main_publish.sh . --decide-only
    → {... :purity-action :rematch-then-push ...}   exit 0, no marker

A green run is not evidence by itself — an exit 0 here could equally mean the
detector failed open and never answered. So the detector was asked directly,
and it is NOT a fail-open:

    task:            BL-1309
    warning:         nil          ← the walk COMPLETED; this is a real answer
    unlanded-count:  31
    blockers:        []

That is the whole ticket in one measurement. **Thirty-one unlanded siblings on
a real tip, and every one of them reads approved, so the land proceeds.** Under
the superseded option 1 this identical tip would have refused on all 31 — which
is precisely the deadlock BL-1375 was raised to clear, reproduced here on live
data rather than argued from the four-ticket incident.

Note the two absences remain asymmetrical and both were exercised: `warning:
nil` is the detector answering (fail-open not taken), while `blockers: []` is
31 positive readings of "approved" — not 31 unknowns waved through. A sibling
with no readable ticket file would have appeared in `blockers`, as unit row 04
pins.

Ordering re-checked for the fail-open path: `blockers` is fully computed BEFORE
the first `println`, so a crash inside `blocking-siblings` cannot emit a
half-written refusal - it yields empty output and fails open through the same
`|| true` whose removal the mutation sweep kills.

By coder.
