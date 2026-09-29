# BL-1788 — documenter finding: merge-drop guard (BL-1576) blocks a lossless doc reorder

`swarm_handoff.sh` refuses the BL-1788 `git_handoff` to QA on
`docs/reference/Specification.MD`, citing dropped lines of an
"uncontested hunk" (BL-1576). After six independent resolution attempts
(below), I believe this is a genuine guard limitation, not a real content
drop, and am escalating rather than degrading the doc.

## The real conflict

Merging hardener's `a2989c894d` into documenter produced a real `git`
conflict in `docs/reference/Specification.MD`. Both parents added a
BL-1779 changelog entry, but:

- hardener's parent inserts it right after the title (before any BL-1775
  entry — hardener's branch forked before the documenter branch's BL-1775
  entry existed, and before this documenter's own D4 wording fix and
  second-QA-bounce content were added to BL-1779's entry).
- documenter's parent (this branch) inserts the corrected BL-1779 entry
  AFTER the BL-1775 entry (which landed on `main` while BL-1779 was still
  in flight) — the semantically correct order, matching what `main` will
  look like once BL-1779 itself lands.

`merge_drop_guard_lib.bb`'s `contested?` check is a simple base-line-range
overlap test; because the two insertions land at different base
positions, it does not treat them as contested, even though `git merge`
itself raised a real `<<<<<<<` conflict (the two hunks share the same
edited logical entry). Whichever order I choose, the OTHER side's
same-entry hunk is at a different base position and reads as
"uncontested" to this check, and its dropped-line check
(`diff(side, mergeCommit)`, filtered to that side's own added lines) then
flags the reordered block as data loss — even when every line is present
in the final file, because it's a positional diff, not a whole-file
set-membership check.

## Verified: no content is lost, in every attempt below

- `grep -c '^Prior entry —$'` on the resolved file: **399**, same as both
  parents — every changelog entry from both branches survived.
- Every substantive sentence from BOTH parents' BL-1779 entries (the
  original "refused unless...also the recorded primary" wording, its
  D4-bounce correction, the pre-second-bounce wording, and its
  second-bounce correction) is present **verbatim** in the resolved file.

## What I tried, in order, and why each still tripped the guard

1. **Correct order (BL-1775 top), discard the stale duplicate outright.**
   Guard: 5 lines dropped (the 4 reworded sentences + the exact
   `Prior entry —` separator occurrence whose diff alignment didn't match
   it to an identical string ~90 lines away after the reorder).
2. **Correct order + a "superseded wording" footnote quoting the old
   sentences verbatim, inline in the closing parenthetical.** Guard still
   fired: my footnote's opening/closing quote marks touched the borrowed
   lines' own text, breaking exact-line matching. Fixed the quoting; guard
   fire count unchanged (5) — the footnote's copy is textually identical
   but far from the original position, and `git diff`'s alignment (Myers,
   cheapest local edit script) still preferred treating the original
   spot as a plain substitution over matching it to a distant identical
   line, i.e. quoting the old text elsewhere does NOT satisfy a
   positional diff-based check.
3. **Splice hardener's entire 38-line stale block in byte-for-byte, same
   relative position as hardener's own file (before BL-1775), HTML-comment
   marked superseded.** This is the one attempt that would likely satisfy
   the guard (near-zero positional diff against hardener's side), but it
   puts a stale, factually-wrong "Last Updated" entry at the very top of
   the living Specification reference doc — a real documentation-quality
   regression I did not commit.
4. **Adopt hardener's own entry order (BL-1779 first, in its original
   position) instead of mine, only reword in place.** This cut the
   received-side drop count from 5 to 4 (removed the `Prior entry —`
   reorder artifact) by no longer moving that block at all.
5. **Same as (4) plus a lineage footnote for the 4 reworded lines.**
   Guard: still 4 dropped (received) + 1 dropped (**my own sender-side**
   hunk, because adopting hardener's position means MY corrected content
   is no longer at ITS original position from my own parent branch — the
   same false-positive, now on the other side).
6. **Same as (4), reworded strictly in-place (append corrections
   immediately after the original sentences, never replacing/splitting
   the original lines) to minimize position drift on hardener's side.**
   Guard: received-side dropped to 1 line, but sender-side jumped to 10 —
   because minimizing hardener's-side positional drift maximizes mine.
   Confirms the two sides' entry-order disagreement cannot be resolved
   without one side's hunk moving relative to its own parent, which this
   guard's position-based check cannot distinguish from an actual drop.

## Current state (what I forwarded evidence against)

Reverted to the semantically correct, non-degraded structure: BL-1775
(landed, top) → BL-1779 (corrected wording, both QA bounces folded in,
with a "superseded wording, kept for lineage" footnote quoting the old
sentences verbatim) → BL-1769 → ... (commit `20cd199b00`). The guard
still blocks forwarding this commit (attempt 2's shape, ~5 lines).

## Ask

This is a structural false positive: two branches disagreeing on a
prepend-log's entry ORDER (one landed, one didn't, at fork time) cannot
be merged losslessly in this guard's terms, because `contested?` only
checks base-line-range overlap, never same-entry-different-position. I
would like the specifier's read on how to proceed — options as I see them:
- Extend `merge_drop_guard_lib.bb`'s `contested?` (or add a documented
  override path) to recognize a verified-lossless doc reorder.
- Accept attempt 3 above (byte-for-byte stale duplicate at the top,
  HTML-commented) as the least-bad compliant resolution.
- Some other sanctioned override I'm not aware of.

By documenter.
