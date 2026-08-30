# Worktree-drift storm, 2026-08-30 — timeline and attribution finding

Specifier, ~16:20Z. Raised by architect (`note` `20260830T161226Z_001293`)
and hardener (`note` `20260830T161255Z_001037`), both priority 00, both
asking for a defect ticket.

## What the roles saw

`ready_for_next.sh`'s `WORKTREE_DRIFT_DETECTED` guard fired repeatedly:
tracked files modified with **no in-progress task and no authoring commit**,
plus new untracked scripts. Nine drift stashes in ~17 minutes, across four
worktrees:

| Stash tag (UTC) | Worktree |
|---|---|
| `worktree-drift-20260830T155552Z` | cleaner |
| `worktree-drift-20260830T155709Z-part2` | cleaner |
| `worktree-drift-20260830T155814Z-part3` | cleaner |
| `worktree-drift-20260830T160012Z` | architect |
| `worktree-drift-20260830T160043Z` | hardender |
| `worktree-drift-recurrence-20260830T160602Z` | hardender |
| `worktree-drift-documenter-20260830T161157Z` | documenter |
| `worktree-drift-architect-recurrence-20260830T161204Z` | architect |
| `worktree-drift-20260830T161210Z` | hardender |

Reported drift paths: `swarmforge/constitution/articles/02_handoffs.md`,
`swarmforge/roles/architect.prompt`, `swarmforge/roles/cleaner.prompt`,
`swarmforge/scripts/handoff_lib.bb`, `swarmforge/scripts/swarm_handoff.bb`,
`swarmforge/scripts/swarmforge.sh`, plus untracked
`reverse_audit_handoff_test_runner.bb`, `test_propagation_conf_parsing.sh`,
`wait_pipeline_drain.sh`.

## The content is commit 44d2d42591

`44d2d42591 "Steal upstream reverse git_handoff hops and two-call
AUDIT_REQUIRED."` — author `t`, `Co-authored-by: Cursor`, committed
**2026-08-30 16:03:28Z**. Its file list is the drift list:
`02_handoffs.md`, `architect.prompt`, `cleaner.prompt`, `swarm_handoff.bb`,
`swarmforge.sh`, `remote_control_launch_lib.sh`, the pack confs, and — as
NEW files — `test/reverse_audit_handoff_test_runner.bb` and
`test/test_propagation_conf_parsing.sh`.

**The drift predates the commit.** First stash 15:55:52Z; commit 16:03:28Z.
So the content reached role worktrees while it was still uncommitted
working-tree state in the master checkout.

## It is NOT the BL-373 / BL-1233 launcher sync

Checked, not assumed:

- `sync_worktree_scripts()` (`swarmforge.sh:1170`) copies only
  `swarmforge/scripts/` and `swarmforge/profiles/`. It does **not** reach
  `swarmforge/constitution/` or `swarmforge/roles/` — three of the drifted
  paths are outside its reach entirely, and no other script under
  `swarmforge/scripts/` copies a constitution article or a role prompt into
  a worktree (`grep -rnE '(cp|rsync)[^|]*(constitution|roles/[a-z]*\.prompt)'`
  -> no non-test hits).
- The BL-373 guard is wired on the live path (`swarmforge.sh:1188,1191`
  call `sync_worktree_scripts.bb`, no raw `cp -R`), and BL-1233's ambient
  `GIT_DIR` scrub is present in that wrapper.
- Probed live: no ambient `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`;
  `git -C .worktrees/hardender ls-files -- swarmforge/scripts` -> **1184**
  paths (not the 0 that made BL-1233 fail open); `rev-parse --show-toplevel`
  resolves the destination's own root. `should-copy?` would therefore skip
  every tracked path.
- Consistent with that: the only drifted file the guard SHOULD copy is the
  untracked trio — untracked in the master checkout too
  (`?? swarmforge/scripts/wait_pipeline_drain.sh`), so the copy is their
  only delivery mechanism, which is BL-373's stated invariant working as
  designed.

BL-1233 is closed (`backlog/done/`), and this is not a reopening of it.

## Where that leaves it

The tracked-file half has no mechanism inside the swarm that explains it.
The remaining candidate is the operator's own tooling: the commit is
co-authored by a Cursor agent, and a Cursor agent pointed at a worktree
(`--workspace '$role_worktree'`, `swarmforge.sh:1782`) writes into that
worktree directly. That is a question only the human can answer, so it was
raised via `role_ask.bb` rather than guessed at — minting a defect against
the launcher would be minting against a mechanism just verified to be
behaving correctly.

## Immediate advice to the roles (sent as notes)

The content is now on `main` at `44d2d42591`. Post-16:03Z the correct
response to seeing these paths dirty is **merge `main`**, not another
stash — a stash now hides content the branch is supposed to receive. The
nine stashes above are recoverable and should not be dropped until the
human confirms none of them contain a role's own real work.
