# BL-1610 — specifier adjudication of the documenter's blocked sends, 2026-09-17

Inbound: documenter `note` 001328 to the specifier, priority 00, created
2026-09-16T21:44:58Z, "BL-1576 merge-drop guard false-positive blocks
BL-1599/1607 sends, evidence". Documenter evidence (its tree, cbde915b2e):
`.worktrees/documenter/backlog/evidence/BL-1576-merge-drop-guard-false-positive-documenter-20260916.md`.
Adjudicated 2026-09-17 06:11Z-06:30Z from the master checkout.

## What the documenter hit

`swarm_handoff.sh` refused BL-1599 and BL-1607 (and, per its later
commits, BL-1605 and BL-1608) with the BL-1576 message: merge
`c96761faa1` "dropped 3 lines of the received side's uncontested hunks in
backlog/standing-reds.tsv". `c96761faa1` is "Merge QA 6607854833 into
documenter" at 2026-09-16 20:36:00Z, parents `d10849128c` (the documenter's
own tip) and `6607854833` (QA's BL-1602 land note). Neither parent is in
any of the four received commits' ancestry, so `side-label`'s ancestor
fallback labelled the documenter's own side "received"; the "dropped"
lines were BL-1606/1607 register rows a coder commit had removed
prematurely and QA's side restored - content the documenter verified
correct against the live register. The documenter tried
`abandoned_commits:` (not consulted by this gate) and refused to fabricate
a `This reverts commit` trailer. Correct on both counts.

## Why BL-1610 owns it (verified, not inferred)

Every one of the four documenter dequeues is LATER than the merge:

| task | received | dequeued_at |
|---|---|---|
| BL-1599 (first) | 46c409305c | 2026-09-16T21:24:59Z |
| BL-1607 | 706fe62dc4 | 21:37:26Z |
| BL-1608 | f77775e090 | 21:50:28Z |
| BL-1605 | ca45c7b15f | 21:57:52Z |
| BL-1599 (final) | 4356ab57c1 | 22:02:05Z |

So the sender's HEAD at each dequeue already contained `c96761faa1`, and
BL-1610's `received_at_head` bound excludes it:

```
git -C .worktrees/documenter rev-list --merges 46c409305c..6ad1d3f616            # lists c96761faa1 (10 merges)
git -C .worktrees/documenter rev-list --merges 46c409305c..6ad1d3f616 --not 073a34b5e1   # omits it
```

(`073a34b5e1` is the documenter's first-parent HEAD at 22:02Z, the final
BL-1599 dequeue.) Invariant 2 (blob identity) would NOT have excused the
first BL-1599 shape - `46c409305c:backlog/standing-reds.tsv` is
`a48c0133…`, `2be80a55f8:` is `72eaddd…` - so this is shape 2 of the same
defect, distinct from BL-1606's route-git_handoff shape: a cross-parcel
merge-up merge made before receipt, reachable from the forward, mislabelled
by the ancestor fallback. BL-1610 (active, parcel 002139 in the hardender's
new/ since 22:07Z, architect NONE at c80be224c0) is the owner. No new
ticket.

## D1 found while measuring: the build admits UPSTREAM roles' merges

Running the parcel's own library (architect tip `c80be224c0`, which carries
the coder's `bad08ffacb`) on the documenter's final BL-1599 shape:

```
bb .worktrees/architect/swarmforge/scripts/merge_drop_guard_lib.bb .worktrees/documenter 4356ab57c1 6ad1d3f616 073a34b5e1
{"merge":"6e5087cd43…","path":"extension/vitest.bl1599.stryker.config.mjs","side":"sender","lines":12,"excused":true}

bb .worktrees/architect/swarmforge/scripts/merge_drop_guard_lib.bb .worktrees/documenter 4356ab57c1 6ad1d3f616
{"merge":"c96761faa1…","path":"backlog/standing-reds.tsv","side":"received","lines":3,"excused":true}
```

With the head bound the scan still names `6e5087cd43` - "Merge hardener
46c409305c into cleaner", 21:47:13Z, a merge the CLEANER made, which
reached the documenter through the received commit's own ancestry
(4356ab57c1 → hardender → architect → cleaner). `merge-commits` scans
`head..forwarded`; the received commit's ancestry, which the pre-BL-1610
`received..forwarded` excluded by construction, is re-admitted whenever
the sender's head lacks it - i.e. for every fresh parcel. Here the finding
is excused only because the documenter left that stryker config alone. A
hardender, which edits stryker configs as its job, forwarding a path an
upstream merge one-sidedly resolved, would be refused for a merge it never
made and cannot redo - a NEW false-positive lane the fix would introduce.

Invariant 1's prose ("a merge the sender did not make after receipt never
produces a finding") is violated as measured; its checkable predicate
("reachable from the forwarded commit and not from the sender's own HEAD")
admitted the build. That is a spec imprecision: the eventual bounce is
spec-attributed (class `spec-gap`), not the coder's.

## Amendment (ticket YAML on main, this commit)

- Invariant 1: reachable from forwarded and from NEITHER the received
  commit NOR the head; excused or not, never a finding on an upstream
  merge.
- Wanted / How: the scan is `git rev-list --merges --reverse <forwarded>
  ^<head> ^<received>`; stampless fallback unchanged (`forwarded ^received`).
- qa_e2e step 1 gains the documenter shape above (expected: 0 findings
  with head; 1 excused, 0 blocking without).
- Feature: scenario 01 gains row 5, added INSIDE the parcel on the bounce
  (BL-1385: the parcel is past the coder, main's copy is not edited):

  `| the sibling branch's tip, after the sibling itself made a one-sided merge that dropped uncontested hunks on a second path | a plain commit on that second path | changes that second path against the received commit | queued with no merge-drop finding |`

  The pre-amendment build refuses this row (non-excused: the forward
  changes the path); the amended scan queues it.
- `human_approval` stays `approved`: the row makes an approved FIRM
  statement testable and changes no approved outcome.
- Notes (priority 00) to the hardender (holder), the coder (rebuild) and
  the documenter (reporter).

## Declined: a `dequeued_at`-time bound for stampless parcels

A prior specifier pass (06:01Z-07:00Z, cut off by the 07:00 respawn) left
this row uncommitted on main's copy of the feature; discarded here (a
feature edit on main is forbidden at this stage) and recorded so it is not
lost:

  `| main's tip, on a parcel that carries no head stamp but a dequeue time later than the old merge | a plain commit on another path | changes nothing on the dropped path | queued with no merge-drop finding |`

Not adopted: the stampless fallback is today's scan plus the blob excuse,
which excuses every stampless shape measured (both b-shapes above and
BL-1606's nine); a clock bound is a weaker mechanism than the graph and
would need its own trust argument. If a stampless refusal recurs after
BL-1610 lands, the coordinator-note claim path below is the remedy, and a
ticket can be minted on that evidence.

## The four stranded parcels are moving without this fix

The coordinator's dropped-parcel self-alarm sent the documenter note
009010 at 06:03Z; a `note` in_process has no `commit:` header,
`received-commit-for-task` returns nil and the gate returns
`{:findings []}` - the same path the coder used for BL-1606. BL-1608
reached QA as 001329 (commit 8dc0efdb00) at 06:05Z; BL-1605/1599 (and
BL-1607, tip 598af6a4c7) follow from the same note. Nothing for the
specifier to route.

By specifier.
