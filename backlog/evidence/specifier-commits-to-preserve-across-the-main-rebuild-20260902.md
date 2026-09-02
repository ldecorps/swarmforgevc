# Commits that must survive the local-main rebuild — 2026-09-02 18:37 UTC

The coordinator holds the repair: restoring content will not unblock the push
because the merge commit `a427bacdb4` itself stays flagged, and a history
rebuild is pending. I am holding — no further commits or merges to `main` from
the specifier until the coordinator says otherwise.

Fifteen commits sit in `origin/main..main`. Whoever rebuilds should carry every
one of them EXCEPT the broken merge; none of them is expendable and several are
not mine. Listed oldest-last as `git log` prints them:

```
faeecf8b1b  Record the five BL-1338 paths restored in the worktree      (specifier)
1b41afef11  Approve BL-1345: record human_approval                      (human)
b4e7a18c43  BL-1345: mint the stale mono-router marker mis-staffing     (specifier)
d4e356c4fa  BL topic record for BL-1345                                 (tooling)
3809c99042  BL topic record for BL-1340                                 (tooling)
57174f3af6  Promote BL-1340: paused -> active for coder                 (coordinator)
08b0aa95ef  BL topic record for BL-1338                                 (tooling)
3222685ab3  Close BL-1338: QA hand-landed on origin/main (a1450efaa3)   (coordinator)
ade60c93b7  active_backlog_max_depth 4 -> 5 via headroom_cap_raise_cli  (coordinator)
467672de55  Record the interrupted-merge revert, correct my claim       (specifier)
d2dd2d7ac2  Restore the backlog half of what the merge reverted         (specifier)
756a53bfbf  Approve BL-1344: record human_approval                      (human)
cba2ac2f43  Operator seat model -> claude-opus-5 (human directive)      (operator)
59f58cee68  BL topic record for BL-1344                                 (tooling)
293da7cafe  BL-1344: mint the babysitter finding waive                  (specifier)
```

Three of these are HUMAN actions, not agent work, and are the ones that would
be silently expensive to lose: `1b41afef11` and `756a53bfbf` record the human's
approval taps on BL-1345 and BL-1344, and `cba2ac2f43` carries the human
directive "operator should update its model to version 5". An approval erased
by a rebuild is invisible afterwards — it reads as never-granted, which is the
[[erased-approval-is-invisible-pending-may-mean-destroyed]] hazard.

`a427bacdb4` is the one commit to drop. Its whole content is the eleven-path
revert; nothing original was authored in it.

Also still true and independent of the rebuild: the five QA-exclusive paths are
restored in the master worktree, unstaged. If the rebuild replays `origin/main`
they come back with it and the worktree copies become redundant — check before
committing them, rather than committing both.

By specifier.
