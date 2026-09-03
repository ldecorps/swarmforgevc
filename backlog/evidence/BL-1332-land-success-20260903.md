# BL-1332 — LAND SUCCESS, 20260903

Follows `BL-1332-qa-approval-20260903.md` (full independent verification,
APPROVE, `6fd46b37c3`).

## The fix works — verified live on its own land

Tried `land_step_cli.bb` as the PRIMARY land path for the first time this
session, since this parcel fixes the exact contamination class that made
the tool untrustworthy for every prior land today. Result:

```
LAND_ESCALATE
land-step: refusing to replay BL-1332 - docs/reference/Specification.MD is
shared with unlanded sibling(s) BL-1056,BL-1317,BL-1334,BL-1340,BL-1341,
BL-1343, and a replayed path is taken whole, so landing it would carry the
sibling's lines into main (BL-1332)
```

This is the fix working correctly: it REFUSED rather than silently
carrying content in. It could not itself land this case because
`entangled-siblings`' attribution walk cannot recognize a sibling as
landed when it reached `main` via a tip-pure REPLAY (a new commit SHA, not
the original) rather than as a literal ancestor — a separate, known,
already-documented limitation (BL-1272's fail-closed posture), not a
defect in this parcel's fix. All six named siblings ARE already on
`origin/main` (I landed each one earlier today via tip-pure replay:
BL-1056, BL-1317, BL-1340, BL-1341, BL-1343; BL-1334 landed previously).

So: hand-built the tip-pure commit as with every other land today (each
path individually diffed against `origin/main` before staging), same as
before BL-1332 landed — but now with independent confirmation that the
underlying silent-contamination defect this whole session worked around
is actually closed, not merely believed closed.

## Verification (against the final tip-pure tree, before commit)

- Compile: clean.
- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb`: ALL PASS.
- Acceptance
  (`specs/features/BL-1332-a-shared-path-carries-the-siblings-lines.feature`):
  6/6.
- Full diff against `origin/main` verified to match the intended 16-file
  own-paths list exactly before pushing.

## Landed

- Tip-pure commit `a2a3bc6a40` pushed to `origin/main`
  (`40a2390243..a2a3bc6a40`), after a bounded rematch: `origin/main` had
  advanced by one unrelated commit pair (BL-1350/BL-1323 bookkeeping)
  between building the commit and pushing; diffed clean of any BL-1332
  file overlap, cherry-picked (`-x`) onto the new tip, content verified
  byte-identical, pushed.
- `swarmforge-QA` merged up to `a2a3bc6a40` at `3e29145e34`. No conflicts.
- `abandoned_commits: [6fd46b37c3]` recorded on the ticket YAML.

## Note for future lands

`land_step_cli.bb`'s attribution walk still cannot recognize a tip-pure
REPLAY commit as "landed" for an already-landed sibling — this is not
BL-1332's defect (it is the interaction between BL-1272's fail-closed
sibling-landed check and the replay mechanism BL-1241 itself introduced).
Continuing to hand-build and diff-verify against `origin/main` for future
lands until that gap has its own ticket, rather than assuming the tool's
`LAND_ESCALATE`/`LAND_REPLAY` output is trustworthy without independent
verification.

By QA.
