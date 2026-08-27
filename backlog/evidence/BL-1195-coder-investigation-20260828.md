# BL-1195 coder investigation — deliverable 1 (2026-08-28)

## What I read

The preserved stash (`.worktrees/coder` `stash@{0}`, tag
`coder-worktree-stray-revert-BL1191-BL1184-20260827`, underlying content
`a4aec863c`), still present and untouched. Full diff read directly (not
summarized from memory).

## What it actually contains

A precise, surgical revert of exactly two shipped features, cleanly - not
random corruption:

- **BL-1191** (wake-dedup): `handoff_inject_lib.bb` loses its
  `wake_dedup_lib.bb` load-file and the `wake-dedup-lib/...` call inside
  `notify-delivered-recipient!`, reverting to the pre-BL-1191 notify path
  verbatim. `swarmforge/scripts/test/test_swarm_handoff_sync_deliver.sh`
  loses its entire scenario 03 ("rapid self-notes → BL-1191 wake dedup
  suppresses stacked wakes") - the exact scenario that would fail if this
  revert were real.
- **BL-1184** (briefing shift-velocity chart): `handoffd.bb` loses
  `briefing-shift-velocity-json` entirely; `briefing_email_lib.bb` loses
  every shift-velocity branch in its diagram-heading/diagram-note-line/
  diagram-section-from-sources functions, reverting to the 2-source
  (architecture + burndown) shape those functions had before BL-1184.

Both reverts are clean, complete, and internally consistent - exactly what
`git checkout <pre-ticket-sha> -- <path>` (or an equivalent whole-file
copy from an older tree) produces, never a hand-edit or a partial/garbled
change.

## Root-cause hypothesis (strong candidate, not confirmed by live reproduction)

**`sync_worktree_scripts.bb`'s tracked-path guard (BL-373), fed a
momentarily wrong `git ls-files` answer by the SAME git-index-collapse
class of corruption this session already confirmed twice for other
worktrees** (`backlog/evidence/BL-592-architect-worktree-anomaly-20260827.md`:
`swarmforge-architect`'s HEAD tree collapsed to 3 paths this same day; my
own `swarmforge-coder` branch ref was twice overwritten with fixture
`init`/`seed` commits this session, `backlog/evidence/BL-1198-...md` -
same underlying still-unpromoted BL-1196 JS-side git-env-leak fix in both
cases).

Traced mechanism: `sync_worktree_scripts.bb`'s `should-copy?`
(`sync_worktree_scripts_lib.bb`) is a bare set-membership check - a
destination path copies FROM the launching checkout's own
`swarmforge/scripts/` UNLESS `git -C <worktree> ls-files -- swarmforge/scripts`
already lists it as tracked. This is exactly BL-373's own fix and, as the
ticket itself already verified, correctly protects these files IN THE
NORMAL CASE (they are always tracked, so `tracked-paths` always contains
them and `should-copy?` returns false - "left to git"). But `tracked-paths`
is computed FRESH, from THIS worktree's OWN git index, on every
`./swarm` (re)launch (`swarmforge.sh:1165`) - and if that index is
TRANSIENTLY collapsed to a near-empty tree (the exact shape both other
2026-08-27 incidents this session independently confirmed), `git ls-files`
returns nothing for `swarmforge/scripts/`, `should-copy?` flips to true
for every file under it, and the launcher blindly OVERWRITES the
worktree's real (BL-1191/BL-1184-inclusive) files with the LAUNCHING
checkout's own copies - which, if the launching checkout itself lagged
these two tickets at that moment (plausible mid-session, before either
had landed on `main`), are exactly the pre-ticket bytes found here.

This produces every observed symptom: uncommitted (the copy never goes
through git), no authoring commit anywhere (correct - nothing committed
it), reverted to older-but-real content (the launching checkout's actual
prior bytes, not garbage), a clean/complete revert (a real file copy, not
a corrupted write), and a wholesale deletion of a test file whose scenario
did not exist yet in the older source copy (rather than a partial/garbled
delete).

## Why this is not confirmed, only a strong candidate

I did not reproduce it live (deliberately collapsing this worktree's git
index to test the theory is itself a destructive, risky operation on a
shared, already-fragile repo this session - not something to do without
explicit authorization). No reflog trail exists for uncommitted
working-tree content, so there is no direct forensic timestamp tying a
specific corrupted-index moment to a specific `./swarm` relaunch. The
hypothesis is offered as the most evidence-consistent explanation found,
not as a closed root cause.

## Disposition

- Not attempting a fix to `sync_worktree_scripts.bb`/`sync_worktree_scripts_lib.bb`
  themselves in this pass - BL-1196 (the underlying git-env-leak fix this
  hypothesis depends on) is the more direct fix if the hypothesis holds,
  and is already ticketed (unpromoted). Re-diagnosing/re-fixing it here
  would duplicate that ticket's own scope.
- Deliverable 2 (the standing worktree-drift guard) ships regardless, per
  the ticket's own instruction - see the ticket's own implementation notes
  for what it does and does not cover.
- BL-1184/BL-1191 themselves confirmed unaffected, per the ticket's own
  `out_of_scope` - not re-verified or reworked here.
