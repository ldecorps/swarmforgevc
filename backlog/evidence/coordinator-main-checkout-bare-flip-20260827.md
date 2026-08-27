# Main checkout's `.git/config` flipped to `core.bare = true` mid-session (2026-08-27 ~23:29)

## Observed

While running `swarmforge/scripts/promote_and_route_next.sh BL-1199` from the
shared main checkout, the script printed:

```
ADVISORY|orthogonality|epic swarm-reliability is also active on BL-1198
fatal: this operation must be run in a work tree
```

and returned non-zero. `BL-1199` itself was left untouched in
`backlog/paused/` (no corruption to the ticket file). Immediately after,
every plain `git status`/`git commit` in the main checkout started failing
with the same `fatal: this operation must be run in a work tree` error.

## Root cause found

`cat .git/config` showed:

```
[core]
	repositoryformatversion = 0
	filemode = true
	bare = true
	...
```

`core.bare = true` on a checkout that has a working tree makes git refuse
every working-tree operation. Fixed by:

```
git config --file .git/config core.bare false
```

Confirmed `git status` works again afterward, and all `.worktrees/*` linked
worktrees were unaffected (checked each with
`git -C <worktree> rev-parse --is-bare-repository` → all `false`).

## Why this matters / why it's not closed

This is the exact symptom class BL-1196 and BL-1200 already describe
("test git/shell fixtures must not inherit ambient GIT_DIR redirect") — but
those tickets are about *test fixtures* leaking an ambient GIT_DIR/bare
redirect. Here the flip landed on the **real, live, shared main checkout**
itself, not a test fixture, and I cannot yet confirm what set it:

- It coincided with the `BL-1199` promote/route attempt, but
  `promote_and_route_next.sh` / `route_backlog_to_coder.sh` have no obvious
  reason to touch `core.bare` at all — plain YAML moves + a handoff send.
- This checkout is under heavy, continuous concurrent write pressure (a
  background process was committing "BL topic record for BL-*" roughly
  every 1-3 seconds throughout this session) — another concurrent process
  (a role's shell test, a fixture setup/teardown for BL-1196/1200's own
  expedite runs sitting in `.worktrees/expedite-BL-1196` /
  `expedite-BL-1200`) could plausibly have hit the exact ambient-redirect
  bug those tickets name and mutated the wrong `.git/config` by mistake.

I did not chase further — this is domain root-cause work, not coordinator
bookkeeping. Surfacing as evidence, not swept.

## Ask

Please adjudicate: is this in-scope for BL-1196/1200 (their guard should
also have caught/prevented a real-repo hit, not just a fixture one), or
does it need its own critical defect ticket ("main checkout `.git/config`
core.bare can be flipped by a concurrent process, breaking every writer")?
Given the blast radius (blocks every role sharing this checkout), I'd rate
this severity: critical if a new ticket.

`BL-1199`'s own promotion is held pending this — see its ticket notes.

By coordinator.
