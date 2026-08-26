# BL-1016 — already delivered by BL-979, which is in flight

BL-1016 asks for exactly the work BL-979's parcel already contains. Not
"similar work": the same three edits to the same two files, verified below.
Implementing it would produce an empty diff, and Article 1.9 forbids
forwarding a commit with no functional change - so this is reported rather
than worked.

- **Author**: coder, 2026-08-21.

## The ticket is right about main

`origin/main` still carries BL-585 scenario 03:

```
git show origin/main:specs/features/BL-585-pipeline-board-ticket-column-matrix.feature
  | grep -c "the epic prints as a per-ticket caption"   ->  1
```

So `main` really is red, exactly as the specifier verified independently.

## It is already fixed in the coder branch, inside BL-979

BL-979 (the pipeline-board axis pivot) had to resolve BL-585's pre-pivot reds
under its own "no standing pre-pivot reds" constraint. Scenario 03 was already
red at that point - BL-956 had replaced epic captions with title captions and
left it behind - so it was retired in the same pass, and that scope judgement
was recorded rather than buried, in
`backlog/evidence/BL-979-coder-findings-20260821.md`:

> **BL-585 sc03 was already red before this parcel** … It was retired here
> because it is the same class, its successor (BL-979 sc06) is green, and it
> was sitting in a file this parcel was already rewriting. Flagging it as a
> scope judgement rather than burying it.

All three of BL-1016's declared invariants are already satisfied here:

| BL-1016 invariant | state in this branch |
|---|---|
| 1 — retirement never removes the last assertion of a live behaviour | successor is BL-979 sc06 (caption content unchanged: truncated title / `(no backlog entry)`), green. Independently re-checked by the architect during BL-979's review: *"sc03(epic caption)→BL-979 sc02/03 — genuinely superseded, no live check deleted"* |
| 2 — no orphaned handler | both handlers removed, and `parseEpicToken` (their only remaining caller) with them. `grep -c "the caption line\|whose epic is\|parseEpicToken"` → **0** |
| 3 — the narrative carries no false sentence | the "becomes a short caption line under the matrix" promise is gone; the Feature block is re-tensed to record what the slice did. `grep -c` → **0** |

`node specs/pipeline/cli.js specs/features/BL-585-pipeline-board-ticket-column-matrix.feature`
in this branch: **8 pass / 0 fail**.

## Why main is still red, and what actually unblocks it

BL-979 was bounced by the architect on an unrelated defect (two stale
pre-pivot assertions in `conciergeTick.test.js`, D1), refixed, and
re-forwarded to the cleaner. Its content - including this retirement - is on
`swarm/coder` and moving forward again. **`main` goes green when BL-979 lands**;
nothing else is needed and no second parcel can help, because the change
already exists here and cannot be committed twice.

The ticket's title says the red was "masked until BL-979's pivot was
reverted", which reads as though the pivot were abandoned. It was not - only
the bounced commit was reverted out of the ARCHITECT's branch, per the
standing bounce-revert rule. The work itself was never withdrawn.

## Recommendation

Close BL-1016 as superseded by BL-979 rather than promoting it. If the
specifier would rather keep it as the tracking ticket for main's redness, it
should be marked blocked on BL-979 and verified at BL-979's landing commit -
but it must not be routed to a coder, who can only produce an empty diff.

This file is committed to `swarm/coder` and lands with the branch.
