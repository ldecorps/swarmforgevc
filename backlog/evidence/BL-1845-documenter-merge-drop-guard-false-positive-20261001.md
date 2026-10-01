# BL-1845 documenter: merge_drop_guard_lib.bb false positive blocks send

## What happened

Sending BL-1845's git_handoff to QA is refused by `swarm_handoff.sh`'s
BL-1576 merge-drop gate:

```
Cannot send git_handoff for BL-1845 a local-model seat's qwen runs interactive:
merge <SHA> dropped 3 lines of the received side's uncontested hunks in
docs/reference/Specification.MD; merge <SHA> dropped 1 line of the
sender side's uncontested hunks in docs/reference/Specification.MD
```

This recurred identically across three independent reconstructions of
the same merge (hardender's `a1a3dccc89` into this branch at `c0c87f2792`):

1. A wholesale-file-replacement resolution (this branch's three new top
   entries + hardener's full content verbatim).
2. The same, with a missing `Prior entry —` separator added back.
3. A precise git-native `--no-conflict-style=diff3` resolution, keeping
   both sides' real hunks exactly at their own base-line positions.

All three produced byte-verified-correct final content (every
Specification.MD entry present exactly once, confirmed by direct diff
against both parent commits' unique content) and all three still
tripped the same ~3-4 line finding.

## Root cause (traced in merge_drop_guard_lib.bb)

`lines-lost` (merge_drop_guard_lib.bb:130) matches by **line TEXT alone**,
not by position: `own-removed`/`own-added` are `set`s of line strings
from one side's own base→side hunks, and any `+`/`-` line in
`diff(side, mergeCommit)` whose TEXT matches is flagged — regardless of
where in the file that text actually sits.

Hardener's branch (`a1a3dccc89`) independently deduped the same stale
duplicate `BL-1830` Specification.MD entry this branch had already fixed
(`e5d77a629b`), but reordered the surviving copy to the top of the file
(ahead of `BL-1846`) rather than leaving it where this branch has it
(after `BL-1846`, with this branch's own three new entries ahead of
both). Hardener's own hunk-2 (base `@@ -72 +38,33 @@`) removes the
single-point `Prior entry —` separator line and replaces it with the
relocated `BL-1846` paragraph — so `"Prior entry —"` (the exact text)
sits in hardener's own `own-removed` set for that hunk.

Because every entry boundary in this file uses the same literal
separator text `Prior entry —`, and this branch necessarily adds that
exact line at its own (different, but equally correct) entry boundaries
when incorporating hardener's content after its own three new entries,
the guard's set-based matcher cannot distinguish "the merge resurrected
hardener's specific removed line" from "the merge legitimately added an
unrelated separator with the same generic text elsewhere in the same
file." The same shape likely recurs for the BL-1830 paragraph body text
itself (duplicated verbatim across two historical copies), which is
exactly the kind of content this gate was built to protect — just
colliding with itself here because both sides' fixes, reordered
differently, reuse the file's own repeated boilerplate.

## Why this is very likely a false positive, not a real drop

Verified directly (not just via the gate) at each of the three attempts:
- `grep -c` for each of BL-1830/1837/1842/1845/1846's own "Last Updated"
  opening line: exactly 1 each.
- Entry count (`grep -c '^\*\*Last Updated:\*\*'`) matches the expected
  sum (hardener's deduped 324/326 + this branch's new entries), with no
  unexplained delta.
- `diff` of hardener's full unique content against the corresponding
  slice of this branch's merge result: byte-identical.

## What I did not do

I did not use the `This reverts commit <sha>` excuse convention — this
is not a bounce revert, and using it here would misrepresent what
happened.

## Ask

Is there a known remedy for this shape (duplicate/boilerplate-collision
false positive in `merge_drop_guard_lib.bb`), or should BL-1845 be sent
by some other sanctioned path while this is looked at? Parcel is ready
(doc commits, evidence, tests green) and held at documenter pending
this.

By documenter.
