# BL-1654 — land-escalate: closed-owner stray is a content SUBSET of origin/main, not identical, 2026-09-20

Re-running `land_step_cli.bb BL-1654 <commit>` after applying the
specifier's condition (f) restore (commit `0aab479e40`):

```
LAND_ESCALATE
ENTANGLED_SIBLING BL-1630
ENTANGLED_SIBLING BL-1650
ENTANGLED_SIBLING BL-1656
land-step replay: could not cherry-pick stray evidence commit a458407d145f5ead1fbfac4e971c4d8fd05ef1d1
```

BL-1630, BL-1650 and BL-1656 are genuinely unlanded right now (all three
bounced tonight — `BL-1630-bounce-20260920.md`, `BL-1650-bounce-20260920-2.md`,
`BL-1656-bounce-20260920.md`), correctly named, not the blocker.

## The actual blocker

`a458407d14` ("BL-1639: QA review pass evidence (NONE)", `By QA.`) is a
closed-owner (BL-1639, done) pure-evidence commit touching only
`backlog/evidence/BL-1639-QA-20260919.md`. Reproduced the cherry-pick
directly in an isolated clone of `origin/main`:

```
git cherry-pick -x a458407d14
CONFLICT (add/add): Merge conflict in backlog/evidence/BL-1639-QA-20260919.md
```

Neither side is empty — this is NOT the D1 "already-applied" shape
(`cherry-pick-already-applied?` correctly does not fire; the diff is not
empty). `origin/main`'s copy of the file is a STRICT SUPERSET of the
stray commit's copy: both start identically (the same "NONE" verdict
text, `By QA.`), but `origin/main`'s also has a `## Detail` section
(BL-1639's own later, more complete QA evidence commit already landed).
The stray commit is an earlier, incomplete snapshot of the same file,
now subsumed by what's already on `origin/main` — but not byte-identical,
so cherry-pick sees a genuine conflict rather than a no-op.

## Why this doesn't fit an existing condition

Conditions (d)/(e)/(f) in
`backlog/evidence/BL-1537-specifier-land-escalate-adjudication-closed-owner-20260912.md`
all describe a stray ABSENT from `origin/main`, or byte-IDENTICAL to it.
This is a third shape: present, but a subset — main's own later work on
the same ticket already carries everything the stray commit added, plus
more. Landing the stray's content would be a strict no-op-or-regression
(it can't add information main lacks); refusing to land BL-1654 over it
serves no purpose either.

## Disposition

Not bouncing BL-1654 (nothing in its own diff is wrong; the fully-passing
checklist and clean condition-(f) restore stand). Noting the specifier
(priority 00) for adjudication of this new stray shape — recommend
treating "stray's content is a subset of origin/main's content at that
path" the same as "identical" for landed-sibling purposes (skip the
cherry-pick, no new commit, per the `cherry-pick-already-applied?`
codepath's own spirit), but leaving that classification to the specifier
rather than deciding it myself. BL-1654 stays approved, verified, and
unlanded in `backlog/active/` pending that ruling.

By QA.
