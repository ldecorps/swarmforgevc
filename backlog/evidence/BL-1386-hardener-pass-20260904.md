# BL-1386 — hardener pass, 2026-09-04

Merged architect commit `7b0dd648c0` (post D1 bounce-fix, re-reviewed
COMPLIANT — `backlog/evidence/BL-1386-architect-pass2-20260904.md`).
Independently re-ran every gate rather than trusting the evidence trail.

## Checks re-run, all independently

- `bb swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb` —
  ALL TESTS PASS.
- `bb swarmforge/scripts/test/master_main_reconcile_lib_property_runner.bb`
  — ALL PROPERTIES HOLD, 500 runs. Explicit non-vacuity lines for BL-1386's
  own invariants confirmed present and passing, including "a failed abort
  neither clears ownership nor falls through - the 2026-09-04 orphan cannot
  recur silently" and the 12-cell merge/abort generator-reach line.
- `bash swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh`
  — ALL SCENARIOS PASS (ran >120s, detached via the standing 2m-ceiling
  workaround and collected from its own completion marker rather than
  waited on synchronously). Includes the three D1 wiring assertions: the
  daemon reaches the ownership decision and acts on it; an owned merge
  routes to the abort branch, not the human reading; a live human's merge
  still routes to the human reading (BL-1120 intact).
- `specs/pipeline/scripts/run_acceptance.sh` on the BL-1386 feature —
  7/7 PASS.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.

## required_wiring anchors — all three confirmed present

- `swarmforge/scripts/handoffd.bb::merge-abort-failed` — present (the
  `master-main-merge-abort-failed-label` def and its two call sites: the
  failed-abort log, and the `log!` adapter's special-case escalation
  routing).
- `swarmforge/scripts/handoffd.bb::master-main-merge-owner.json` — present
  (`master-main-merge-owner-file` def).
- `specs/pipeline/steps/bl1386ReconcileOwnsItsMergeSteps.js::registerSteps`
  — present, 2 occurrences (export + call site).

## BL-149 cooldown gate (both changed production files)

- `swarmforge/scripts/handoffd.bb` — DECISION: skip-cooldown (file_age_days
  1.39, cooldown 3 days).
- `swarmforge/scripts/master_main_reconcile_lib.bb` — DECISION:
  skip-cooldown (file_age_days 2.07, cooldown 3 days).

Both files are still inside the cooldown window (this ticket's own coder
and architect-bounce-fix commits are what makes them recent) — per the
gate, no additional hand-authored mutation sweep on top of what the
coder/architect already ran this pass. This matches the ticket's own
explicit direction ("Babashka has no mutation/CRAP/DRY wired: the hardener
records the degraded fallback and gates on those runners plus
test_handoffd_master_main_reconcile_wiring.sh") and the cleaner's own
stage note. The pure-lib layer is additionally covered by the property
runner's explicit per-invariant non-vacuity proofs (500 runs), which is
substantively equivalent to a mutation-testing pass on the decision
functions the daemon adapters call.

## BL-113 Gherkin mutation (both Scenario Outlines in the feature)

Ran `run_gherkin_mutation.sh` soft over
`specs/features/BL-1386-the-reconcile-sweep-never-orphans-a-merge-it-started.feature`
against `specs/pipeline/steps/index.js` (discovery registry). 6/6 mutants
killed, 0 survived, 0 errors. Manifest stamped in the feature file (only
the stamp changed).

## CRAP / DRY

Both `npm run crap` and `npm run dry` are scoped to `extension/src/**`.
This parcel touches no file under `extension/src` — CRAP/DRY N/A, matching
the cleaner's own stage note.

## Result

No defect found. No orphaned test/mutation processes left behind
(confirmed via `pgrep`). Forwarding to documenter.

By hardender.
