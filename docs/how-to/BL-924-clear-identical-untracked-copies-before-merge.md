# BL-924: Clearing Byte-Identical Hot-Synced Copies Before a Worktree Merge

**`clear_identical_untracked_and_merge.bb <worktree-root> <ref>` merges a
role worktree up to `<ref>` without failing on untracked hot-synced copies
that could not lose anything if overwritten.**

## The Problem This Fixes

`sync_worktree_scripts()` copies helper scripts into every role worktree at
launch with `cp -R`. Those copies land **untracked**. `git merge` refuses
any merge that would overwrite an untracked file — a correct default in
general, because an untracked file may be the only copy of its content
anywhere.

Here that premise is usually false: the untracked copy came *from* the
tracked content the merge is bringing in, and is byte-identical to it.
Overwriting it loses nothing, but a bare `git merge` refuses anyway. Worse,
git only names the collisions it has already reached, so clearing them by
hand is iterative — remove the named paths, retry, meet the next batch.
Measured 2026-07-25: fast-forwarding `swarmforge-QA` to `main` took two
rounds of hand-clearing, with a `... 10 more` elision hiding the true count.
This is the same `sync_worktree_scripts()` hot-sync mechanism already
recorded as the phantom-revert root cause in BL-373 — same source, a
different failure mode.

## What The Script Does

Run it in place of a bare `git merge <ref>` when a worktree merge fails with
`The following untracked working tree files would be overwritten by merge`:

```
swarmforge/scripts/clear_identical_untracked_and_merge.bb <worktree-root> <ref>
```

1. Finds every path that is untracked in `<worktree-root>` **and** tracked
   at `<ref>` — exactly the set a plain `git merge` would refuse to
   overwrite.
2. Proves each one's on-disk content against `<ref>`'s own tracked blob
   (`git show <ref>:<path>`), read directly off disk since git has no index
   entry for an untracked file.
3. **All-or-nothing**: only if *every* candidate is byte-identical does it
   delete the untracked copies and then run the real `git merge <ref>
   --no-edit`. A single genuine difference clears nothing, merges nothing,
   and exits 1 naming every colliding path in one report — never an
   iterative discovery loop.
4. Any read failure on a candidate (a directory, a dangling symlink,
   non-UTF-8 content) is treated as "not identical," so it blocks the merge
   rather than risking a mistaken clear — the check fails closed.

An untracked file that `<ref>` does **not** track is never a candidate at
all, so it is never touched, regardless of outcome.

## What This Deliberately Does Not Do

- It never clears or merges partially. If any candidate differs, nothing is
  removed and nothing is merged — resolve the difference by hand (it is a
  genuine conflict, not hot-sync noise) and re-run.
- It never touches untracked content that exists on no branch — the one
  case that would be unrecoverable if cleared.
- It does not run automatically as part of any merge-up step yet; invoke it
  by hand when a worktree merge hits this specific untracked-collision
  failure. See `docs/how-to/BL-640-reference-freshness-guard.md` for the
  related (and independent) reference-freshness guard, whose own "what to
  do" section pointed at this ticket before it was built.

## See Also

- `swarmforge/scripts/clear_identical_untracked_and_merge.bb` — the IO
  wiring (candidate discovery, identity proof, clear-then-merge).
- `swarmforge/scripts/untracked_collision_clear_lib.bb` — the pure
  all-or-nothing decision logic (`plan-untracked-collision-clear`).
- `specs/features/BL-924-hot-synced-untracked-copies-block-fast-forward.feature`
  — the three acceptance scenarios (identical copy never blocks, genuine
  collisions are reported all at once, no-branch-content is never
  destroyed).
- **BL-640** — the reference-freshness guard that asks a role to merge
  `main`; this is one way that merge can now succeed instead of blocking on
  hot-synced collisions.
- **BL-373** — the phantom-revert incident that first identified
  `sync_worktree_scripts()`'s untracked copies as a recurring source of
  trouble.
