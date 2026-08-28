# Reconcile conflict prediction now trusts git's own verdict, not a text search (BL-1236)

## The gap

`merge-tree-reports-conflict?` (`master_main_reconcile_lib.bb`) decided
whether a predicted master/main reconcile merge would conflict by running
the legacy three-argument `git merge-tree <base> <a> <b>` and **grepping its
unified-diff output for words like "CONFLICT"**. Any merged file whose own
prose happened to contain those words — and this repo's tickets and
evidence files do, constantly — read as a predicted conflict, even though
git itself could merge the trees cleanly. Ten resets discarded already-committed
work this way; one of them destroyed a human's approval tap three minutes
after it landed.

`post_hotfix_merge_origin.bb` carried a second, byte-identical copy of the
same broken predicate (`would-conflict?`) at its own entry point — not
caught by the original ticket text, which named only the daemon's reconcile
sweep as the caller (specifier amendment `dcb279a79`, finding F1). Both
copies also returned `true` — i.e. "conflict", i.e. reset — whenever
`git merge-base` itself failed, so a case where git could not answer at all
was silently treated the same as a real conflict.

## Fix

Both call sites now share one verdict function in
`master_main_reconcile_lib.bb`, built on `git merge-tree --write-tree <a>
<b>` — the same flag `tree_collapse_guard_lib.bb` already uses in
production — read by **exit code**, never by scanning merged content:

| Exit code | Verdict | What happens |
|---|---|---|
| `0` | clean | Safe to merge/absorb as planned. |
| `1` | conflicted | Genuine conflict — the existing recovery path runs unchanged. |
| `>= 2`, or a git too old to support the flag | **unavailable** | Git itself could not answer. Surfaced, never collapsed into "conflict" (reset) or "clean" (attempt a merge that could itself fail and reset). |

The **unavailable** outcome is the fix's core change: previously a
`merge-base` failure or any git error returned `true` (conflict, reset) —
fail-open dressed as fail-closed. It is now its own non-destructive outcome
that blocks the automated path and surfaces rather than guessing either
way.

Both call sites — `handoffd.bb`'s reconcile sweep and
`post_hotfix_merge_origin.bb`'s CLI — now delegate to the shared verdict;
neither keeps its own copy of the old text-search predicate. The
genuine-conflict recovery path (`git reset --hard origin/main` after a real,
git-confirmed conflict) is unchanged — reopening it was explicitly out of
scope for this ticket.

## Where it lives

| Call site | File |
| --- | --- |
| Shared verdict | `swarmforge/scripts/master_main_reconcile_lib.bb` |
| Daemon reconcile sweep | `swarmforge/scripts/handoffd.bb` |
| Post-hotfix merge CLI | `swarmforge/scripts/post_hotfix_merge_origin.bb` / `post_hotfix_merge_origin_lib.bb` |

## What did not change

- The executors (`absorb-dispatch-plan`, `post-land-absorb-plan`,
  `absorb-with-merge!`, `merge3-origin!`) are untouched — they were already
  correct, they were simply fed a wrong verdict.
- The genuine-conflict recovery path (reset after a real conflict) behaves
  exactly as before.

## Related

- [BL-891 master-main reconcile sweep](BL-891-master-main-reconcile-sweep.md)
  — the sweep whose merge-tree foresight this predicate feeds.
- [BL-1214 `:ff-absorb` attempts a real 3-way merge before resetting local
  main away](BL-1214-ff-absorb-attempts-real-merge-before-reset.md) — the
  sibling fix on the same reset-discards-commits failure mode, one layer
  down the same ladder.
- [BL-1130 landing on main without external conflict
  resolution](BL-1130-land-on-main-without-external-conflict-resolution.md)
  and
  [BL-1141 refuse-rematch must rematch
  live](BL-1141-bl1138-residual-refuse-rematch-not-executed.md) — the
  executor behavior that consumes this predicate's verdict; unchanged by
  this ticket.

Acceptance:
`specs/features/BL-1236-reconcile-conflict-prediction-from-git-verdict.feature`.
