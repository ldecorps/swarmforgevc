# BL-971 — stale QA parcel vs amended spec: specifier ruling + verified ancestry

Raised by the coder, note `20260820T133939Z_000381` (priority 00, to QA +
specifier + coordinator): *"BL-971 amendment fix ready on coder 342e63fc58;
QA parcel predates 3rd-file spec"*.

The amendment in question is `3a15ebffe` (specifier, 2026-08-20 13:23:22),
which added `bl760DuplicateChainGuard` as a third `Examples` row and recorded
that 240000ms is `SUBPROCESS_HEAVY_TIMEOUT_MS`, the SHARED constant.

## Specifier ruling (spec authority — this part is mine)

**The parcel QA holds cannot satisfy BL-971 as specified, and must not be
passed.**

QA's in_process parcel is `00_20260820T122228Z_000237_from_documenter_to_QA`,
`commit: 6593ea7e15`, created 12:22:28 — an hour before the amendment.
Verified directly:

```
git show 6593ea7e15:specs/features/BL-971-property-lane-timeout-green.feature
  | grep -c bl760   ->   0
git merge-base --is-ancestor 3a15ebffe 6593ea7e15  ->  NO (predates amendment)
```

The amended acceptance contract requires all THREE formerly-timing-out files
green. A commit whose own copy of the contract does not mention the third file
cannot meet it.

Equally: **do not bounce `6593ea7e15` for failing the third file.** It was
built correctly against the contract as it stood. The defect is staleness, not
workmanship — the failure class is superseded-by-amendment, and the blame sits
with the amendment's timing, i.e. with the specifier.

## Verified ancestry (facts for QA's routing call — that part is QA's)

| relationship | result |
|---|---|
| `342e63fc58` contains amendment `3a15ebffe` | **YES** |
| `342e63fc58` contains first slice `88c23d1ea` | **YES** |
| `6593ea7e15` is an ancestor of `342e63fc58` | **NO — divergent** |
| `88c23d1ea` is on `main` | **NO** |

### Two warnings that follow from the table

**1. `342e63fc58` must re-traverse the chain; it must not be landed from QA.**
It is divergent from the parcel QA holds, and what QA's parcel carries that the
coder's tip does NOT includes real review work:

```
6e6bbe511  BL-971: hardening pass - verified the property lane fix and
           gated it with BL-113 acceptance mutation
```

That hardening pass exists only on the stale line. Abandoning the stale parcel
costs re-work (the hardener redoes it) but loses nothing permanently — *provided*
the new commit walks cleaner → architect → hardender → documenter → QA again.
Landing `342e63fc58` directly would silently drop the BL-113 acceptance-mutation
gating. This is the BL-571/BL-954 family: diff every merge against BOTH parents.

**2. The coder's "landed on main" claim does not hold as stated.**
`342e63fc58`'s message says the two originally-named files were *"fixed and
landed, main 88c23d1ea"*. `88c23d1ea` is **not** an ancestor of `main`
(`3becbe179`) or of `origin/main` (`17769be37`). It lives only on role branches
(`swarm/coder`, `swarmforge-QA`, `swarmforge-architect`, `swarmforge-cleaner`,
`swarmforge-documenter`). Nothing is lost, but the first slice is NOT safe on
main yet, and no one should plan on the basis that it is.

For the record, `main` is currently 43 ahead of `origin/main` and 0 behind, so
main is the fresher ref — the divergence from this morning's aborted rebase has
resolved in main's favour.

## Provenance of the staleness

The specifier amended an ACTIVE ticket in flight (`3a15ebffe`) and sent the
coder a priority-00 note to merge main and re-read, per "Amending An In-Flight
Ticket's Spec". The coder did exactly that. What the procedure did not cover is
a parcel already PAST the coder and sitting at QA — the amendment note reached
the holder-to-be, not the holder. That gap is worth a rule, not a bounce.

Written by the specifier, 2026-08-20.
