# BL-1303 coder pass, merge-path amendment — 2026-08-31

Commits: 652603514d (merge-path wiring), ab46787808 (audit fix: unloadable
chain refuses). Forwarded to cleaner at priority 50.

## Done
- `swarmforge/git-hooks/pre-merge-commit` now runs
  `check_feature_handler_registration.sh` beside
  `check_pipeline_code_on_main.sh`, over a captured-status chain (no `set -e`),
  not repointed at `run_commit_guards.sh`. Both amended `required_wiring`
  anchors verified as real invocations at the forwarded commit.
- Aggregation extracted to `swarmforge/scripts/commit_guard_chain_lib.sh`,
  shared with `run_commit_guards.sh`. Both callers refuse when it cannot be
  loaded (the extraction had opened a fail-open path: no `set -e`, so a failed
  source left every guard unrun and the hook exiting 0 — measured).
- New standing test `test_pre_merge_commit_hook.sh` (9 cases, registered in
  suite-manifest.tsv); `test_run_commit_guards.sh` 11/11.

## Two items surfaced, NOT fixed here

1. **Fixture rot from BL-1252, repaired in this parcel because all three
   fixtures drive the hook this ticket changes and all three were dead.**
   BL-1252 moved pre-commit's guards behind `run_commit_guards.sh` without
   adding that file to any fixture, so hooks died at "No such file or
   directory" before any guard decided anything:
   `bl632CommitTimeGuardInvariants.property.test.js` 0/1, BL-632's acceptance
   feature 0/11, `test_pipeline_code_on_main_guard.sh` aborting at case 01 —
   all red on `main` today, none caused by this parcel. Now 1/1, 11/11 and 17
   cases. BL-632's acceptance fixture also assumed a global git identity on the
   host; its scenarios commit without `-c`, so with no global identity every
   scenario failed "Author identity unknown" before any hook ran. Repo-local
   identity added.

2. **A pre-existing red now VISIBLE, unowned, left for you to route.** With
   `test_pipeline_code_on_main_guard.sh` running to completion again it reaches
   an assertion that was previously never evaluated:

       FAIL: BL-925 invariant 2: handoffd.bb still runs its own inline
             ancestry git call

   `swarmforge/scripts/handoffd.bb` is byte-identical to `main`
   (`git diff main -- swarmforge/scripts/handoffd.bb` is empty), so this is
   neither caused nor owned by this parcel. The assertion greps handoffd.bb for
   `"merge-base".*"--is-ancestor"`; the two hits (handoffd.bb:3161 and :3357)
   are over `origin/main` and over a generic ancestor/descendant pair, whereas
   the sibling assertion on `check_pipeline_code_on_main.sh` is scoped to
   `swarmforge-QA`. So it is plausibly an over-broad assertion rather than real
   drift — but which of the two it is, is a decision, not mine to take inside
   this ticket.

3. **Feature file has no merge-path scenario.** The amendment added the merge
   wiring requirement and `qa_e2e_procedure` step 6 covers it manually, but
   `specs/features/BL-1303-...feature` still has only the six commit-path
   scenarios (7 tests with the Outline rows). The merge path is covered
   executably by `test_pre_merge_commit_hook.sh` cases 01/03/09 and by BL-632's
   acceptance feature, which exercises real `git merge --no-ff` through the
   real hook. Flagging in case you want a scenario rather than a shell test.
