# Cleaner blocked: BL-640 reference-freshness guard fires on worktree AHEAD of main, not behind (2026-08-28)

## Context

`ready_for_next.sh` now refuses unconditionally with
`STALE_REFERENCE_ELABORATION` for all 5 `swarmforge/constitution/articles/reference/*`
files, even immediately after merging local `main` (which I confirmed via
`git rev-list --left-right --count main...origin/main` is itself ahead of
`origin/main`, so local `main` is the freshest ref available anywhere).

## Root cause

All 5 flagged files trace to one commit, `b28323975` ("BL-1227: trim boot
prefix back under budget and add a live, unpinned budget check"), already
an ancestor of this worktree's `HEAD` (merged in via the coder branch's
own progression while processing BL-1207/BL-1201/BL-1216/BL-1228). BL-1227
carries `required_stages: [coder, qa]` — it deliberately skips cleaner,
architect, hardener, and documenter (`stage_skip_reasons` in the ticket
YAML) and goes straight from coder to QA. It has not yet been QA-approved
and landed on `main`, so `main`'s copy of these 5 reference files is still
the pre-trim (longer, for the inline articles; shorter, for the
reference/ files) version. My worktree's `HEAD` has the post-trim version
one commit early, via coder's branch, not via any merge-up from QA.

The guard (`swarmforge/scripts/reference_freshness_lib.bb` /
`ready_for_next.bb`'s `enforce-reference-freshness-guard!`) computes
`stale-paths` as any path whose content differs between the worktree and
the freshest `main` ref — direction-blind. Its own docstring only
special-cases a path *absent* from the worktree ("not the amendment-
delivery gap this invariant is about"); it does not special-case a path
present with *different, newer* content than `main` (i.e. the worktree
ahead via a fast-tracked, not-yet-landed sibling ticket). "Merge main,
then run ready_for_next.sh again" — the guard's own prescribed remedy —
cannot fix this shape: merging main again is a no-op 3-way merge (only my
side touched these paths since the merge-base), so it refuses
unconditionally, every turn, until BL-1227 lands on `main` through QA.
There is no bypass flag in `ready_for_next.bb` for this guard.

## What I did NOT do

Did not overwrite my worktree's copy of these 5 files with `main`'s older
content — that would discard `b28323975`'s real, human-approved work
(BL-1227, `human_approval: approved`) already correctly merged in from
coder's branch. Did not patch `reference_freshness_lib.bb` — that is a
guard-behavior change with no ticket authorizing it, out of scope for me
to invent ad hoc.

## Ask

This blocks `ready_for_next.sh` entirely for this worktree — every future
turn, task or idle — until either (a) QA lands BL-1227 on `main`, at which
point a normal `git merge main` will resolve it, or (b) the guard is
amended to not fire when the worktree's content is a strict extension of
`main`'s at that path (e.g. `main`'s blob is an ancestor-content of the
worktree's, via a fast-tracked ticket not yet landed) rather than a
divergence. Surfacing to specifier + coordinator: is BL-1227 already with
QA, and is (b) worth a ticket, given this guard shape can recur for any
`coder→QA`-only ticket that touches `articles/reference/` while sibling
work is still flowing through the full pipeline in other worktrees?
