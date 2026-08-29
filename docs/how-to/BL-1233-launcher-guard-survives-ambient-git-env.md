# Launcher tracked-path guard survives an ambient GIT_DIR/GIT_WORK_TREE (BL-1233)

## Incident class

BL-373's launcher guard stops `sync_worktree_scripts.bb` from clobbering
git-tracked files in a role worktree: it asks the destination worktree
which paths its own git index tracks, and leaves those to git rather than
copying over them. That guard is correct in isolation and is **fully
defeated** whenever the launcher runs with an ambient `GIT_DIR`/
`GIT_WORK_TREE` in its environment — the live condition on this host.

`-C <worktree>` does not override those variables: git answers for whatever
repo `GIT_DIR`/`GIT_WORK_TREE` name, not the `-C` target. Under the leak,
the tracked-path query for a role worktree returned an empty set instead of
its real ~1142 tracked paths. An empty tracked set reads as "nothing to
leave to git," so the launcher copied the launching checkout's (often
older) bytes over every tracked script in every role worktree — the
pre-BL-373 phantom revert, at full strength, with the fix nominally shipped.
The failure is silent in both directions: exit status is `0`, and the
guard's own "left to git (tracked)" lines simply stop being printed.

It landed on safety gates first in the observed incident — two files
reverted were themselves recent guards (BL-1196's env scrub, BL-1192's
task-scope gate) that had not yet reached `main`, which is exactly why
main's (copied) bytes lacked them. See
[Worktree drift guard](BL-1195-worktree-drift-guard.md) for the detection
side of the same class of incident; this ticket is the fix for the specific
gap that incident's "or that guard has a gap this incident exposes" line
left open.

## What changed

Two changes, both in `sync_worktree_scripts.bb`'s query path:

| Piece | Role |
| --- | --- |
| CLI wrapper's tracked-path git invocation | Scrubs `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` from the environment before asking, so the query resolves against the destination worktree — same posture as [BL-1196](BL-1196-test-git-fixtures-must-not-inherit-ambient-git-dir-redirect.md)'s scrub, a different call site. |
| `sync_worktree_scripts_lib.bb`'s `trustworthy-tracked-answer?` | Pure fail-closed backstop: trusts a tracked-path answer only when git actually resolved a top-level for the destination worktree **and** it equals that worktree's own canonicalized root. On a mismatch or an unresolved top-level, the CLI copies nothing and refuses loudly, naming both paths. |

The discriminator is the resolved top-level, never an empty tracked set by
itself: a foreign target repo that genuinely does not track `swarmforge/`
still resolves *its own* top-level correctly and must still receive every
script (BL-373's own third scenario) — only git answering for a *different*
repo, or failing to resolve at all, counts as untrustworthy.

## Verify

```bash
GIT_DIR=/path/to/other/repo/.git GIT_WORK_TREE=/path/to/other/repo \
  bb swarmforge/scripts/sync_worktree_scripts.bb <role-worktree>
```

Before the fix: silently copies over every tracked path. After: prints
"left to git (tracked)" lines exactly as with no ambient leak, or refuses
loudly if the destination's own top-level cannot be resolved.

## What this does not cover

- The test-suite and property-suite sites of the same ambient-env class —
  [BL-1196](BL-1196-test-git-fixtures-must-not-inherit-ambient-git-dir-redirect.md)
  and BL-1222 own those. This ticket is the launcher site only.
- Finding and removing whatever exports `GIT_DIR`/`GIT_WORK_TREE` into agent
  sessions in the first place — this makes the launcher correct under a
  hostile environment rather than assuming a clean one.

## Acceptance

`specs/features/BL-1233-launcher-guard-survives-ambient-git-env.feature`
