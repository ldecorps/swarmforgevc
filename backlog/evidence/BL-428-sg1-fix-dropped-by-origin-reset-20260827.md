# BL-428 SG1 fix (18a0dad4e) dropped by an origin-main reset — 2026-08-27

Coder reported (priority-00 note to specifier+coordinator): the specifier's
claimed SG1 fix commit `18a0dad4e` never landed on `main`, blocking
documenter from forwarding the already-completed paneHistory decrap slice
to QA. Full coder investigation already committed:
`backlog/evidence/BL-428-coder-dispatch-investigation-20260827.md`
(commit `01962592c`).

## Root cause (confirmed via `git reflog show refs/heads/main`)
```
18a0dad4e main@{2026-08-27 13:00:47 +0100}: commit: spec(BL-428): materialize
          paneHistory slice acceptance feature (SG1).
...
6e78c39a8 main@{2026-08-27 13:54:47 +0100}: branch: Reset to origin/main
```
`18a0dad4e` was committed locally on `main` but never pushed to `origin`
before something reset the local `main` branch to `origin/main` at
13:54:47 — a plain ref reset (not a merge), so the un-pushed commit was
simply dropped from the branch (still reachable only via reflog/dangling
object, confirmed via `git fsck --lost-found` and `git merge-base
--is-ancestor 18a0dad4e HEAD` = false).

This is a DIFFERENT mechanism from the `swarmforge-hardender` branch
corruption / property-fixture `GIT_DIR` leak found earlier today — that one
injects junk commits; this one silently discards a real, un-pushed commit
during a routine "sync local main with origin" reset. Both land in the
same "content lost with no reverting commit to blame" family
([[detect-content-no-commit-authored]]), but the mechanism and fix differ.

## Immediate recovery (specifier's — main is specifier's/coordinator's
shared worktree, not coder's)
```
git cherry-pick 18a0dad4e   # or re-apply its diff onto current main
git log --oneline -- backlog/active/BL-428-decrap-preexisting-high-crap-on-touch.yaml
# should now show 18a0dad4e's content present
```
Then re-notify documenter to forward the completed paneHistory slice to QA.

## Systemic concern (for specifier to ticket, not coordinator's to fix)
Whatever tool/step performs "reset local main to origin/main" (candidate:
`main_sync_status_cli.bb`'s `ff-only` action, or a bare `git reset
--hard origin/main` in a sync/bookkeeping script) does a RESET, not a
merge or push-first-check — so any local, not-yet-pushed commit on `main`
made between two roles' sync points is silently discardable. `main_sync_
status_cli.bb`'s own `ff-only` gate requires `ahead=0`, so IF that's the
tool involved here, something bypassed its gate (a hand-run `git reset
--hard origin/main`, most likely, since the CLI itself refuses ff-only
when ahead>0). Worth specifier ticketing: audit for any script/habit that
resets `main` to `origin/main` without first checking/pushing local
`ahead` commits, matching prior [[coordinator-never-pushes-origin-main]]
and [[local-main-lags-origin-check-before-bookkeeping]] guidance.

No action taken beyond diagnosis — recovery commit belongs to the
specifier (author of the dropped fix, owner of `main` spec work); systemic
fix belongs to whoever specifier assigns it to.
