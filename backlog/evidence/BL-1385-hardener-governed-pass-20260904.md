# BL-1385 — hardener governed pass (QA-directed), 2026-09-04

QA bounced BL-1385 for the required-stage gap (cleaner/architect/hardener
never ran against coder's concurrency-fix rework,
`backlog/evidence/BL-1385-bounce-20260904.md`) — continuing QA's specified
chain: architect's governed pass
(`backlog/evidence/BL-1385-architect-governed-pass-20260904.md`) flagged
one stale mutation-sweep anchor for this stage to fix, not fixed there
since the tool is hardener's domain (Article 4.1).

Merged architect commit `cd490cb73a` (COMPLIANT, governed pass). Conflict
in the feature file: both sides carried the same 4 scenarios (my 3
hardener-added ones plus the concurrency scenario the specifier's
amendment added) under different numbering, a leftover from the earlier
duplicate-tag merge before the ticket was bounced. Deduplicated, kept the
incoming side's numbering (07/08/09/10); content was otherwise identical
on both sides.

## Stale anchor re-pointed (the item this pass exists for)

Mutant 6 in `bl1385_handler_module_graph_mutation_sweep.sh`
("out/->src/ candidate list emptied") anchored to a literal inline
`for (const cand of [...])` loop that the cleaner's `firstOnTree(cands)`
consolidation replaced with a `const cands = [...]` variable passed to a
shared helper. The old anchor no longer exists on disk, so the mutant
SKIPPED silently (flagged by both cleaner's and architect's governed
passes, not fixed by either — correctly left to this stage). Re-anchored
to the new `const cands = [...]` assignment, mutating it to `const cands
= [];`. Re-ran the full sweep: **9/9 killed, 0 survived, 0 equivalent, 0
skipped** (previously 8/8 non-skipped + 1 skipped).

## Checks re-run, all independently

- `bash swarmforge/scripts/check_handler_module_graph.sh` (no args) —
  exit 0.
- `specs/pipeline/scripts/run_acceptance.sh` on the BL-1385 feature —
  13/13 PASS, including scenario 10 (the concurrency scenario).
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- Both `required_wiring` anchors reconfirmed present:
  `run_commit_guards.sh:73` (`run_guard check_handler_module_graph.sh`),
  `land_step_lib.bb:993` (in the replayed-tree-guards list).
- No orphaned test processes left behind (confirmed via `pgrep`).

## BL-149 cooldown gate

`check_handler_module_graph.sh` — DECISION: run (no prior commit,
fallback age). Hand-authored sweep re-run per above, 9/9 killed.

## BL-113 Gherkin mutation

Re-ran `run_gherkin_mutation.sh` soft over the BL-1385 feature. Correctly
soft-skipped (BL-460): `total=0 skipped_scenarios=2 skipped_mutations=9`
because the two Scenario Outlines' Gherkin text and background hash are
UNCHANGED since my original 2026-09-04 11:15 pass (3+6=9 killed, 0
survived, stamp still embedded in the feature file) — this rework only
added new plain Scenarios (07-10), which carry no Examples and so
generate no new mutants. Not a broken run; a correct stamp-valid skip.

## Result

The one flagged item (stale sweep anchor) fixed and re-verified clean.
No other defect found. Forwarding to documenter.

By hardender.
