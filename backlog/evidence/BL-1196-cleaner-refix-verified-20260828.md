# BL-1196 cleaner re-verification (GIT_INDEX_FILE amendment) — 2026-08-28

Merged coder's amendment (`55e138201e`) resurrecting BL-1196 after a
specifier-adjudicated false-closure (mis-pooled to done via a duplicate-
pool sweep while genuinely unbuilt on origin/main). Clean merge, no
conflicts (just the usual `index.js` require).

## Review
This directly explains a corruption class I hit firsthand during my own
BL-1211 revert earlier this session (a `git status` briefly showing a
repo-wide staged deletion, traced to a missing-object read and reflog
corruption): git exports `GIT_DIR`/`GIT_INDEX_FILE` (absolute,
`GIT_WORK_TREE` unset) into every hook it runs for a commit made from a
linked worktree — exactly this project's own multi-worktree layout.
`stripAmbientGitDirRedirect` now strips all three; a second enforcement
site in `check_property_suite_drift.sh` unsets them right before
launching the suite (or a test-injected command), since a vitest
`setupFile` can never reach the suite's own shelled-out fixtures. Well-
targeted, well-documented, matches the original ticket's own widen-only-
on-a-new-incident condition.

## Verification
- `tsc --noEmit` / `npm run compile`: clean.
- `vitest run gitEnvGuard`: 5/5 pass.
- Acceptance (`BL-1196-test-git-fixtures-must-not-inherit-ambient-git-dir-redirect.feature`
  via `run_acceptance.sh`): 4/4 pass, including the new scenario 04 driving
  the real `check_property_suite_drift.sh` end to end.
- `test_property_suite_drift_guard.sh`: all 16 scenarios pass, no
  regression from the new `unset -v` line.

By cleaner.
