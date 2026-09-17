# BL-1615 / BL-1616 — specifier adjudication of the coordinator's "coder@2 reworks non-forwarding inbounds fresh" note, 2026-09-17

Inbound: coordinator `note` 009027 to the specifier, priority 00, created
2026-09-17T06:55:04Z: "coder@2 reworks non-forwarding inbounds fresh
(BL-1604+BL-1610 today)". Adjudicated 06:57Z-07:25Z from the master
checkout, from the mailboxes and the libraries, not from the summary.

## The diagnosis in the note is wrong about the trigger

coder@2 (`.worktrees/coder2`, branch `swarmforge-coder@2`, added by the
operator's directive 2026-09-16, 1754d784ee / fb40700cf4) did rework two
tickets the coder seat also built. Neither rework came from a
non-forwarding inbound; those are exactly the files it CANNOT reach.

| what coder@2 claimed | from | when | what it did |
|---|---|---|---|
| 009003 "Work BL-1604: now active/assigned in main, merge first - retry" (coordinator, 22:00Z 09-16) | the shared stage queue | dequeued 06:01:48Z | built eca9aaeb96 (06:33Z); found the coder had forwarded 06e6226cdb to the cleaner at 06:15Z; completed 06:41Z, sent "BL-1604 double-dispatched ... mine dropped" |
| 001373 hardender bounce, task BL-1610, commit 539f500112 | the shared stage queue | dequeued 06:41:26Z, no deferral line | rebuilt 7b78e9d58a (06:52Z); found the coder had forwarded its own rebuild 023ca45241 at 06:44Z; completed 06:54Z with nothing sent |

Every `non-forwarding: true` copy addressed to coder@2 (000783, 002144,
000786, 000788, 002148) is still in `.worktrees/coder2/.swarmforge/handoffs/inbox/new/`,
undequeued, two of them with `.chase.json` sidecars - beside three
coordinator "branch behind ... merge up" notes (009012, 009025, 009026).
Eight files, none ever claimable.

## Why BL-1604 was built twice

- 21:14:49Z 09-16: coordinator Work note 008964 to `coder`; the coder
  dequeued it 21:15:02Z and completed it 21:15:08Z - six seconds, the
  BL-1614 stale-read decline.
- 22:00:53Z: the coordinator's retry note 009003.
- 06:00Z 09-17 restart. coder@2 claimed 009003 from the shared queue at
  06:01:48Z. The coder, holding no BL-1604 mail at all, built 06e6226cdb
  at 06:13Z and forwarded it at 06:15:58Z (002016) - resuming the ticket
  it had declined the night before. Two seats, one ticket, one of them
  with no claim.

## Why BL-1610 was rebuilt twice - the mechanism worth a ticket

The specifier's amendment note 001619 ("BL-1610 amended a5e59a0f5b:
rebuild - forwarded ^head ^received, notes row 5") reached the coder at
06:15Z. The coder merged main, rebuilt (76c1ab039e 06:33Z, 023ca45241
06:43Z) and forwarded to the cleaner at 06:44:32Z FROM THE NOTE CLAIM,
before any bounce existed for it - its own evidence says "ahead of the
eventual bounce". The hardender's real bounce 001373 entered the stage
queue at 06:23Z and was claimed by coder@2 at 06:41:26Z.

BL-1004's seat affinity should have deferred that claim: the coder was
the prior worker of BL-1610. It did not, and the library says why:
`handoff_lib.bb` `worked-task-names-in` (507-517) keeps only
`git_handoff` files and their `task` header, and the coder built BL-1610
from Work notes 008954 and 008992 - `note`s whose ticket is in the
message. The coder's worked set held no BL-1610; `rework-claim-decision`
saw no sibling history; coder@2 claimed. That is BL-1004's own incident
(BL-994, 2026-08-20) re-opened for every ticket the coordinator routes the
normal way. **BL-1616** minted: a completed Work note names the ticket its
message names, through the shared attribution, and a `--no-work`
completion names nothing.

## The structural defect coder@2 itself found

`stage-queue-dir` (handoff_lib.bb 470-481) points an @-seat's dispatcher
at the STAGE's new/; `ready_for_next_task.bb` line 274 reads only that.
`handoff_inject_lib.bb` `target-path` delivers `to: coder@2` into the
seat's OWN new/. So reverse-hop merge-only copies (reverse_hop_lib
enumerates every earlier roles.tsv row, seats included - correctly: each
seat's tree needs its copy) and the coordinator's branch-behind notes
(correctly addressed: the branch is the seat's) are dead letters, chased
forever, and the seat's tree merges main only when it happens to claim a
stage-addressed merge-only copy. **BL-1615** minted: the claim path offers
the stage queue and the seat's own new/ together, each file once,
seat-addressed mail to that seat alone. Verified with the library from
the master checkout, matching coder@2's own reproduction
(`.worktrees/coder2/backlog/evidence/coder-at-2-seat-mailbox-undrainable-20260917.md`).

## The prompt rule (landed with this mint, coder.prompt)

An amendment note is not the parcel: merge main, re-read, prepare if you
like, but forward only from the bounce `git_handoff` claim - on a
two-seat stage the bounce may land at your sibling, and a prepared
commit is then abandoned, not sent. The specifier's own lesson: word
amendment notes as "bounce coming" and never as "rebuild".

## Loose ends recorded, not routed

- coder@2's 7b78e9d58a (a second BL-1610 implementation) is orphaned on
  `swarmforge-coder@2` and will conflict with the real BL-1610 when it
  merges up; it should be reverted on that branch first. A note to
  coder@2 is undeliverable until BL-1615 lands; recorded in BL-1616's
  notes for whichever seat or sweep reaches it.
- Until BL-1615 lands, route anything seat-independent to `coder` (the
  shared queue); nothing addressed to coder@2 is read.
- No new ticket for the retry-note double dispatch: a Work note is not a
  rework by design, and BL-1614 removes the stale-read declines that
  produce retries.

By specifier.
