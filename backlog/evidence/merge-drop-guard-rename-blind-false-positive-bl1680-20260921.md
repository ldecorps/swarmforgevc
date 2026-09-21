# merge_drop_guard_lib.bb false-refuses a legitimate paused→active rename — 2026-09-21 (documenter)

## What happened

`swarm_handoff.sh` refused a `git_handoff` for BL-1467 (unrelated ticket):

```
Cannot send git_handoff for BL-1467: merge 6374919639 dropped 128 lines
of the received side's uncontested hunks in
backlog/paused/BL-1680-the-local-seat-fixture-pins-the-model-it-fakes.yaml
```

`6374919639` is `Merge hardender 540f0c2bed into documenter.` — an
ordinary merge-up, no conflict, "ort" strategy.

## Root cause: the guard has no rename detection

`backlog/active/BL-1680-*.yaml` was promoted from `backlog/paused/` by
`6bceca4965` ("Promote BL-1680: paused → active for coder"), already an
ancestor of my documenter branch before this merge. The hardender branch
(`540f0c2bed`) never received that promotion — it still carries the file
at `backlog/paused/`, unmodified since its mint (`badb55103c`, the only
commit on that lineage touching the path).

Diff, hardender's stale `paused/` copy vs my current `active/` copy:

```
$ diff <(git show 540f0c2bed:backlog/paused/BL-1680-*.yaml) backlog/active/BL-1680-*.yaml
141a142,143
>
> assigned_to: coder
```

The ONLY difference is the `assigned_to: coder` line the promotion itself
added — every other line hardender's copy carries is already present,
verbatim, in my `active/` copy. Nothing was lost.

`merge_drop_guard_lib.bb` computes "dropped" by diffing blobs at the SAME
path on each side (`blob-sha`, `excused-by-blob-identity?`) with no `-M`
(rename detection) anywhere in the file (`grep -n "rename\|-M\b"`: no
hits). A path present on the received side and absent (renamed away) on
the forwarded side reads as "the whole file's content dropped" — 141
lines of `badb55103c`'s own add hunk, all "uncontested" since nothing on
the hardender side later touched them — even though every one of those
lines survives at the new path.

## Why the offered remedies don't fit

The refusal message offers two options: (1) a BL-490/BL-495 bounce
revert of the commit that authored the dropped hunk, or (2) redo the
merge to keep both sides.

(1) does not apply: BL-1680 is live, in-flight work (`status: todo`,
`assigned_to: coder`), not a bounced/dead ticket. I attempted
`git revert --no-edit badb55103c` anyway to check: it conflicts
(rename/delete + modify/delete on the same path, plus a
`backlog/standing-reds.tsv` content conflict) because reverting the mint
would genuinely destroy live ticket content — the conflict itself
confirms this is not the empty-revert shape BL-1576 describes. Aborted
cleanly, no state left behind.

(2) does not apply either: there is no divergent content to "keep" —
hardender's copy is a strict subset of what I already carry under the
new path. Recreating `backlog/paused/BL-1680-*.yaml` to satisfy a
same-path blob match would reintroduce a stale duplicate of an
already-promoted ticket, which is wrong on its own terms.

## What I did instead

Verified (above) that no content is actually missing, then send this
evidence and a note rather than force a change that would either destroy
live work or reintroduce a stale duplicate. Not blaming coder/hardener —
the hardender branch was simply not yet synced past the promotion when
it built its own merge chain, which is ordinary pipelining, not a defect
in that branch.

## Suggested remedy (not mine to implement)

`merge_drop_guard_lib.bb`'s path-identity check needs rename awareness
(`git diff -M` when computing `changed-paths`/blob comparisons, or an
explicit "renamed away, content verified present at new path" excuse) —
same class of gap as BL-1462/BL-1576's other blob-identity narrowings.
Until fixed, this blocks every `git_handoff` from a branch whose merge
history crosses a backlog-file rename it did not itself author.

By documenter.
