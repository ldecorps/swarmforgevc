# BL-856 failed-integrity-commit-leaves-work-staged — QA pass — 20260808

Commit reviewed: `71b051f7` (this branch, merge of documenter's forward
`dc4a7fba32` — carrying cleaner's D1 fix `129cfca327`, architect's re-pass
`7d631f13`, and hardener's `90164d8e` as ancestors). Confirmed via
`git merge-base --is-ancestor 129cfca327 HEAD` → true.

## Checks run

- **Unit runner:** `bb swarmforge/scripts/test/commit_integrity_lib_test_runner.bb`
  — ALL TESTS PASSED.
- **CLI shell suite:** `bash swarmforge/scripts/test/test_commit_integrity_cli.sh`
  — 5/5 PASS, including the close-guard-rejection case.
- **Acceptance pipeline:** `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-856-failed-commit-must-not-leave-work-staged.feature`
  — 9/9 scenarios green.
- **Independent manual reproduction** (own throwaway repos, not the
  acceptance suite's own step handlers — per `qa_e2e_procedure` steps 3-5):
  1. Real repo, real `pre-commit` hook exiting 1: before the call `f.txt` was
     " M" (unstaged); `commit_integrity_cli.bb` returned
     `{"success":false,"reason":"commit-failed","attempts":1}`; after the
     failed call `f.txt` was still " M" (unstaged) — not "M " as the
     pre-fix defect described. Confirmed by hand.
  2. Pre-staged `git mv paused/X.yaml active/X.yaml` (the exact BL-681
     promotion shape the ticket cites): before the call `R  paused/X.yaml ->
     active/X.yaml`; forced a commit failure; after the failed call the
     rename was **still staged**, byte-identical — restore is to the
     pre-call snapshot, not a blanket unstage. Confirmed by hand.
  3. Unrelated-writer harm: after a caller's failed commit left no residue,
     had a second writer commit `other.txt` with a bare `git commit`;
     `git show --stat HEAD` on that commit shows only `other.txt` — the
     caller's abandoned edit did not ride along. Confirmed by hand.
- **Wiring:** `commit_integrity_lib.bb`/`commit_integrity_cli.bb` already has
  real callers (`promote_and_route_next.sh` — the exact BL-681 promotion
  path the ticket's `source:` names, `operator_file_question.bb`,
  `pre_qa_gate_gather_lib.bb`, `ticket_close_guard_lib.bb`). This ticket
  fixes the shared library those callers already use, per its own
  Constraints section ("Fix in commit_integrity_lib.bb, so every caller
  inherits it") — no new wiring required, existing wiring confirmed.
- **Bounce D1 (architect, unscoped step registration) verified fixed:**
  `git show 129cfca327` — `registry.defineScoped` with the feature's exact
  title, matching the `bl425RoleSteeringTopicsSteps.js` precedent the bounce
  named.
- **Docs:** documenter's `Specification.MD` entry (`dc4a7fba32`) accurately
  describes the snapshot/restore mechanism, the two distinct snapshot
  points, pathspec scoping, and the new `:index-left-dirty` field. No
  separate how-to needed (internal shared-checkout hardening, no new
  operator-facing command) — consistent with the ticket's own scope.
- **Declared invariants:** all three covered by targeted real-git unit tests
  per hardener's inventory; no bb-side property-test harness exists
  (documented BL-472 gap) — not a gap for this ticket.

## Verdict

**APPROVED.** Fix matches the ticket's stated intent exactly; both measured
harms (silent non-landing, unrelated-writer contamination) independently
reproduced as fixed by hand, not only via the acceptance suite's own step
handlers. Bounce D1 correctly and minimally remediated.

By QA.
