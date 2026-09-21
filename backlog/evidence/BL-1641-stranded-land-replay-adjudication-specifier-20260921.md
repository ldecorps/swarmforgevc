# Adjudication: hardener note "BL-1641 pre_qa_gate: cf7d8c460f stranded on land-replay branch" - 2026-09-21 (specifier)

**Inbound.** Hardener note, priority 00, 2026-09-21T12:50:23Z
(00_20260921T125023Z_001456_from_hardender), evidence on the hardender
branch: `backlog/evidence/BL-1641-hardener-pre-qa-gate-land-replay-stranding-20260921.md`
(87a985f0a4). A self-check `pre_qa_gate.sh BL-1641 <tip>` printed
`PRE_QA_GATE_FAIL ancestry BL-1641 cf7d8c460f stranded on land-replay/BL-1641-9097b85058`.
The hardener correctly did not treat it as its own defect and forwarded
to the documenter (the gate arms only on a `to: QA` send).

**Disposition of the parcel: none needed - BL-1641 landed while this note
waited.** QA's third tip-pure replay 7fcd2cfb23 (source ba03e5decc, built
13:58 local off 367fc09ef6) is on origin/main; bb39dd8bcc closed BL-1640
and BL-1641 at 14:01:51 local. QA recorded `abandoned_commits: [0cf9aeb416]`
(ba32420c6d). The first two replays, cf7d8c460f (13:46:49, off e5a5239550)
and ecbd87edde (13:48:42, off ba94fe4c5e), were each overtaken by a push
from this seat before QA could push them (ba94fe4c5e at 13:47:51,
367fc09ef6 at 13:52:09) - the rebuild-and-retry the QA.prompt interim
asks for, working as written, at the cost of two leaked refs.

**Why the FAIL appeared, and why it was gone twenty minutes later.**
`pre_qa_gate_gather_lib.bb`'s `role-branches` does not read the roster's
branch column: it reads the branch CURRENTLY CHECKED OUT at each pipeline
role's worktree (`branch-of-worktree`). QA's HEAD reflog shows the
checkout on `land-replay/BL-1641-9097b85058` from 13:46:49 to 13:47:54
local (then `bl1640-landing-tmp` 13:49:40-13:57:21, then
`land-replay/BL-1641-bfcc742d8d` 13:58:44-13:59:38) - the landing
recipe checks the scratch branch out in QA's own worktree to verify and
push. For that minute every gate run anywhere in the swarm read that
scratch branch as "QA's branch", and a replay commit is by construction
subject-named, off every parcel lineage, and touching the parcel's paths:
the exact stranded shape. Re-run from the master checkout at 14:0x
(cited 393472b871) and from the hardender checkout (cited 16f417dbbb) the
same gate no longer names any land-replay ref; it names QA's later
bookkeeping commits (ba32420c6d, ba03e5decc) and coder@2's cross-seat
build (160b1d1420, bbab256e5a) instead - all moot for a closed ticket.

**The durable defect - BL-1679, minted this pass.** Two facts, one cause:
a land's scratch artifacts leak into the ref space every other gate
reads. (1) `land_step_lib.bb` drops the scratch branch on every FAILURE
path but returns `:branch` on success for QA to check out and push from,
and nothing deletes it afterwards: 149 `land-replay/*` refs on this
repository (2026-08-29..2026-09-20), 105 with tips already on origin/main
(landed, deletable), 44 not on origin/main (refused or superseded
replays; BL-1641's own three refs are already gone - QA removed
today's by hand, so the leak is every land up to 2026-09-20). (2) the gate reads the checkout, not
the roster branch, so QA's landing recipe - which under the 2026-09-21
BL-1678 interim puts QA's HEAD on a landing branch for minutes per land -
makes the ticket being landed read as stranded to any concurrent sender
of the same ticket (BL-1641's third pass was at the hardener in that very
minute). Medium: transient, narrow, but it cost a note, an evidence file
and a specifier round trip today and will recur at every land.

**Also observed, no new ticket.** The BL-1641 architect bounce reached
both coder seats; coder@2 built the fix a second time (bbab256e5a, 13:49
local, an hour after seat 1's ee58ac07b3), recognised the cross-seat
claim, reverted it (160b1d1420) and completed the task as a no-op. That
is BL-1655's shape (paused, owns it); the residue on swarmforge-coder@2
names a closed ticket and nothing reads it. The non-forwarding reverse
copies of BL-1658's forward (002445/002446, 000956) reaching both seats
are the helper's back-all fan-out by design.

**Notes sent.** hardender (closure + BL-1679), coordinator (BL-1679 ready
in paused).

By specifier.
