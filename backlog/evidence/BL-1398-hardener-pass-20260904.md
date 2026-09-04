# BL-1398 — hardener pass, 2026-09-04

Merged architect commit `03447f1664` (COMPLIANT, clean sweep — both
invariants verified in the actual code, including a correct read of the
transitive-BFS-vs-single-hop discrepancy between the ticket's "How" and
the real implementation as a safe over-delivery, not a defect —
`backlog/evidence/BL-1398-architect-20260904.md`). This is the ticket
whose derivation helper I already relied on directly when resolving the
BL-1395 merge conflict earlier this pass.

## Merge conflicts

`suite-manifest.tsv` only — HEAD already had the full union
(`test_bl1399_freshness_fixture_own_registry.sh` row). Clean, no other
conflicts.

## Checks re-run, all independently

- `test_bl1398_guard_fixture_derives_set.sh` — ALL PASS (8/8): guard
  added/removed on a seam runner copy, a named-but-absent guard refusing
  by name, the real runner's full guard set including
  `check_handler_module_graph.sh`, no hand-written list surviving.
- `run_acceptance.sh` on the BL-1398 feature — 4/4 pass.
- `check_feature_handler_registration.sh` — rc 0.
- required_wiring anchors grepped directly: `run_guard` literal present in
  `bl632CommitTimeGuardInvariants.property.test.js:230/240` (the parsing
  the fixture now performs, confirming it reads the runner's own line
  shape rather than a hand list); `registerSteps` exported from
  `bl1398GuardFixtureDerivesItsSetSteps.js:59/122`.

## BL-149 cooldown gate — hand-authored mutation spot-check

`extension/test/helpers/commitGuardFixtureSet.js` — DECISION: run. Not
covered by Stryker (`--mutate` scopes `out/**/*.js`, compiled from
`extension/src` only; this is test infrastructure under `extension/test/`)
— BL-638/BL-567-class fallback, spot-checking the highest-consequence
invariant rather than trusting the e2e's breadth alone. Mutated the
"throw when the runner names a guard the tree lacks" branch (lines 104-107)
to a silent `continue` instead — **KILLED**
(`test_bl1398_guard_fixture_derives_set.sh` fails: the "a guard the runner
names but the tree lacks refuses, naming it" and downstream checks catch
the silent narrowing immediately). Confirms this safety-critical
invariant (a fixture must never silently run a narrower guard chain than
production) is genuinely load-bearing, not merely asserted. File restored
byte-identical after the mutant, diffed against a pre-mutation backup.

## BL-113 Gherkin mutation

`grep -c "Scenario Outline"` on the feature: 0 — not run (no Outline to
mutate; matches the ticket's own note "IR-DRY: run on the feature file at
mint", i.e. this was checked at mint time).

## CRAP / DRY

`git show --stat 03447f1664` touches no file under `extension/src` — N/A.

## Process / fixture hygiene

No orphaned `node --test`/mutation processes (three unrelated bash pids
seen by `pgrep` are not test runners). Hand-mutation backup removed after
use, file diffed byte-identical after restore. Clean working tree.

## Result

Both declared invariants (derivation reads the runner live, never a hand
list; a named-but-absent guard fails loud rather than silently narrowing
the chain) re-verified independently, including a real mutation kill on
the safety-critical throw path. Forwarding to documenter.

By hardender.
