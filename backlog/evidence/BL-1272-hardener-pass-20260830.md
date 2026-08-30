# BL-1272 — hardener pass, 2026-08-30

Reviewed the architect-forwarded commit `3e2cb9e15f` (COMPLIANT verdict) for
the land step's landed-sibling reporting fix.

## Merge-time correction (recorded separately, not this ticket's defect)

Merging `3e2cb9e15f` conflicted in `docs/reference/Specification.MD` against
an unrelated, still-in-flight BL-1240 changelog entry. First resolution
(dropping the entry) was based on a mistaken belief that all of BL-1240 had
been reverted; corrected after checking history directly — only a specific
fixture-closure REWORK (`b82a1e856a`) was architect-bounced and reverted
(`b92f2d8fa4`), while the base BL-1240 feature passed architect design review
(`0e1f124aa`, no defect found) and is legitimately still active, unlanded
work. Restored the entry to match what cleaner's and architect's own
worktrees already carry (commit `ecbdc9fed`). Unrelated to BL-1272's own
content; recorded here only because it happened during this ticket's merge.

## Suites re-run (all green, independently confirmed)

- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` → ALL PASS
  (BL-1272's new cases and every pre-existing BL-1241 case)
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1272's own feature → 6/6
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1241's feature → 4/4
  (confirming BL-1241, the ticket this one extends, is undisturbed)
- `extension/test/bl1272LandedSiblingInvariants.property.test.js`
  (`--config vitest.properties.config.mjs`) → 3 tests, all green

## Mutation hardening

### BL-149 cooldown gate

Both changed production files are inside the cooldown window (age 0.91
days, cooldown 3 days) — `bb swarmforge/scripts/mutation_cooldown_gate.bb .
swarmforge/scripts/land_step_lib.bb` and `...land_step_cli.bb` both decided
`skip-cooldown`. No mutation-test pass on the Babashka lib/CLI this turn per
the gate (still actively churning — this ticket itself is one of the
churns). Babashka also has no wired mutation tool (BL-472 deferred); when
the cooldown clears, any pass on these files is a hand-authored sweep, not
Stryker.

### BL-113 Gherkin acceptance mutation (soft), the one Scenario Outline

Scenario "A sibling is reported as entangled only on positive evidence it
is unlanded" (4 examples): 8/8 mutants KILLED, 0 survived, 0 errors —
recorded in the feature file's own manifest.

No survivors, no equivalent mutants to record this pass.

### CRAP / DRY

No `src/*.ts` production file is touched by this parcel — the only new
`extension/` file is the property TEST file
(`bl1272LandedSiblingInvariants.property.test.js`), kept out of
coverage/mutation/CRAP/DRY per the shared separation rule. The behavior
change lives entirely in `land_step_lib.bb` / `land_step_cli.bb`
(Babashka), which CRAP/DRY tooling does not cover (BL-472 deferred).

## Verdict

CONFIRMED. No new test gap found; no defect. Forwarding to documenter.
