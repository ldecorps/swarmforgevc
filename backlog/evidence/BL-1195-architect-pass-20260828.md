# BL-1195 architect pass — 2026-08-28

## Reviewed commit

`1d5fbcc87d` (cleaner, coder commit `89faba98ec`), merged into architect
clean (no data-loss risk this time — verified via `git merge-tree
--write-tree` + rename-aware deletion diff before merging: only normal
ticket promotions (paused→active for BL-1195/BL-1199/BL-1190) and additive
new tickets/evidence, nothing dropped).

## Deliverable 1 (investigation)

Coder read the preserved stash (`a4aec863c`) directly, confirmed both
reverts (BL-1191, BL-1184) are clean/complete file-level copies, not
corruption, and proposed a well-evidenced but explicitly unconfirmed root
cause (`sync_worktree_scripts.bb`'s tracked-path guard fed a transiently
collapsed `git ls-files` answer by the same git-index-collapse class this
session hit twice elsewhere). Correctly declined to fix that hypothesis
here (BL-1196 already owns it) and correctly declined to re-touch
BL-1184/BL-1191 (out of scope, confirmed unaffected). Good judgment,
nothing to bounce.

## Deliverable 2 (guard) — architecture review

- `worktree_drift_lib.bb`: pure decision logic
  (`unexplained-drift`/`drift-detected?`/`drift-report`), no I/O — correct
  separation, matches this project's own established pure-lib +
  real-adapter pattern (same shape as `master_main_reconcile_lib.bb`
  reviewed for BL-1198 yesterday).
- Wired into `ready_for_next.bb`'s `enforce-worktree-drift-guard!`, run
  BEFORE dispatch decides task vs batch. Uses `dispatch-lib/git-root`
  (per-worktree), degrades to silent pass on any git hiccup (never a false
  refusal from a transient git error — deliberately asymmetric with its
  own purpose, and correct: a guard against silent drift must not itself
  become a new silent-failure surface). "In-progress" is read from
  `in_process/` specifically, not `new/` — correctly matches scenario 01's
  premise (a role that hasn't dequeued anything has no legitimate reason
  to have modified a tracked file at all).
- Constraint check ("never auto-discard drifted content"): `drift-report`
  only emits instructions (`git stash push -u -m ...`) and never performs
  the stash itself — correct, a report-only pure function must not
  side-effect a repo-wide mutation.
- Scope boundary is honest and documented: `git diff --name-only HEAD`
  only sees tracked-file changes, so a brand-new untracked WIP file is
  correctly out of this guard's reach (documented in-file, not silently
  assumed).

## Verification (run directly)

- `bb swarmforge/scripts/test/worktree_drift_lib_test_runner.bb` — ALL PASS.
- `bb swarmforge/scripts/test/worktree_drift_lib_property_runner.bb` — ALL
  PROPERTIES HOLD, 100 runs. Encodes the ticket's one declared invariant as
  P1 (no task → every modified path reported) / P2 (in-progress task →
  always empty). Includes an explicit non-vacuousness check comparing the
  real implementation against a `broken-always-clean` mutant — confirmed
  the mutant would wrongly pass while the real implementation correctly
  flags it.
- `env -u GIT_DIR -u GIT_WORK_TREE bash
  swarmforge/scripts/test/test_worktree_drift_guard.sh` (isolated `mktemp`
  fixture, safe to run) — ALL PASS, all 3 scenarios (drift-with-no-task
  refuses; in-progress-task's own edits not flagged; clean worktree passes
  silently), matching the ticket's `qa_e2e_procedure` items 1-3 exactly.
  Item 4 ("if deliverable 1 found a fix, exercise it") correctly not
  shipped — deliverable 1 did not confirm a fix, by design.
- `specs/pipeline/steps/index.js:820` registers
  `bl1195WorktreeTrackedContentDriftSteps` — confirmed present.

## Not applicable to this parcel

No `extension/` files touched — dependency-cruiser gate and co-change tool
both out of scope, same as BL-1198 yesterday. Pure `swarmforge/scripts/*.bb`
+ specs/ infra, gated by its own unit/property/shell-wiring suite per
engineering.prompt's Babashka carve-out.

## Disposition

Architecturally compliant, declared invariant correctly encoded and
verified non-vacuous by direct run, investigation disposed with good
judgment (no premature fix, no scope creep). Forwarding to hardener.
