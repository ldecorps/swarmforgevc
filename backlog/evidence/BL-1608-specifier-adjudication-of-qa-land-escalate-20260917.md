# BL-1608 / BL-1607 — specifier adjudication of QA's LAND_ESCALATE note, 2026-09-17

Inbound: QA `note` 002851 to the specifier, priority 00, created
2026-09-17T06:55:42Z: "BL-1608 land LAND_ESCALATE, entangled w/
1185,1576,1599,1605,1607". QA evidence (its tree, 0221a3a899 / 9300f34557):
`.worktrees/QA/backlog/evidence/BL-1608-QA-land-escalate-20260917.md`
(BL-1607 appended to the same file - one escalation per class, Article
4.4). Adjudicated 07:17Z-07:40Z from the master checkout.

## The refusal, read from the land step's own text

```
land-step: refusing to replay BL-1608 - backlog/evidence/BL-1576-merge-drop-guard-false-positive-documenter-20260916.md's
only owner(s) BL-1576 are closed on origin/main (backlog/done/) and no commit
of BL-1608's own touches [it] - never decided silently (BL-1546)
```

The `ENTANGLED_SIBLING` lines (BL-1185, BL-1599, BL-1605, BL-1607) are
ordinary unlanded pipelining on the documenter's one branch; the replay
excludes their paths by attribution and they are not what refused. The
single blocker is one path: the documenter's cross-ticket report of the
merge-drop false positive, committed on 2026-09-16 as `BL-1576: evidence -
...` (cbde915b2e). BL-1576 is closed; `closed-on-main?` (land_step_lib.bb
681) reads it under `backlog/done/` alone, and the BL-1546 clause (line
1487) refuses rather than silently exclude a path a closed owner can never
be shown to have landed.

Verified by a scan of every path in `origin/main..9bdf467215` (BL-1608's
re-sent tip): 106 paths differ; exactly one has owners that are all closed
and exclude BL-1608 - that file. Its blob is `4a74857ed9` at cbde915b2e,
8dc0efdb00, 9bdf467215 (BL-1608), 47e50af7ee (BL-1607's QA tip),
4e4e60a6a5, 6ad1d3f616 (BL-1599), 8393648d8b (BL-1604) - and absent on
main. Every documenter-lineage parcel now in QA's inbox (BL-1604, BL-1608,
BL-1610, BL-1605, BL-1599) carries it and would hit the same refusal.

## Disposition: land the stray path on main, verbatim, untagged

The file is genuine evidence and content-neutral. Committed on main in
this pass byte-identical (`git show cbde915b2e:<path>`), under an untagged
subject so main's own history attributes it to nobody. The land step
diffs `origin/main..<tip>` as a two-tree diff: a path byte-identical on
both sides is not in the diff, so no attribution is asked and the replay
proceeds with BL-1608's own paths only (BL-1605's unresolved handler,
attributed to BL-1605, is excluded as an unlanded sibling exactly as the
how-to describes). Renaming or moving the file would not help - the tips
carry the OLD path.

QA: `git fetch origin` and re-run `bb swarmforge/scripts/land_step_cli.bb
BL-1608 9bdf467215` (and `BL-1607 47e50af7ee`); expect `LAND_REPLAY` with
`ENTANGLED_SIBLING` lines for the still-unlanded siblings and no BL-1546
refusal. Land the replay commit, record `abandoned_commits:` per the
how-to. QA's retraction of its own BL-1608 D1 (the BL-1185 register row
present pending QA's land, same-batch precedent) stands - nothing here is
a bounce to any author.

## The class, and what stops it recurring

A role wrote a report on a closed ticket's mechanism and named and
tagged it after the closed ticket. That is the second closed-owner
incident in five days (BL-1537's 5dbd34f27f, 2026-09-12, motivated
BL-1546 itself). Two halves landed with this pass:

- documenter.prompt: a report on a shipped mechanism's defect is filed
  under the OPEN ticket that owns the fix (ask the specifier by note if
  none exists), never the closed one.
- **BL-1617** minted (paused, pending approval): the commit-msg chain
  refuses a role-branch subject whose first ticket id is closed on
  origin/main, naming the closed ticket and what to lead with; silent on
  main, on untagged subjects and on an unreadable origin/main.

By specifier.
