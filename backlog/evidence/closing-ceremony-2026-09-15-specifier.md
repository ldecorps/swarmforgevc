# Closing ceremony — shift 2026-09-15 (specifier lean pass, BL-820)

Packet: `.swarmforge/lean/ceremony/2026-09-15.json`, `deliveredAt`
2026-09-15T00:00:00Z, folded 07:55 local, read via the coordinator's
priority-00 note (`00_20260915T065503Z_008404`). The run was `pending` on
arrival (`outcome: null`), so the outcome is recorded in the store.

**Outcome recorded: `process_ticket`, ref BL-1576** (`backlog/paused/`,
`human_approval: pending`, epic `swarm-reliability`, `severity: high`).
A second action of the same pass is a BL-990 bounce-attribution correction
for BL-1568, recorded in the bounce store and described below.

## What the packet showed

Four tickets walked the chain overnight - BL-1568 (twice), BL-1486 (QA ->
documenter -> QA), BL-1457 and BL-1462 - and closed. Path taken QA, cleaner,
architect, hardender, documenter, coder. Dwell hotspots QA 4618811ms,
hardender 3263635ms, documenter 1489529ms. Bounces: `acceptance` x1
(BL-1568, 1f92d0bf8a, blamed coder) and `behavior` x1 (BL-1486,
f9d6ee9209, blamed documenter). Stalls: cleaner chase x4 (one per ticket),
QA chase+nudge, coder chase, documenter nudge, hardender nudge. Hypotheses:
QA dwell; the `acceptance` class; "4 chase(s) in cleaner". Quality dial:
lower x1 (architect, stage_transition), raise x5 on stalls/bounce
(cleaner, coder, documenter, hardender, QA) - advisory, the coordinator's
half.

## The signal I acted on - BL-1486's bounce -> BL-1576

QA's `backlog/evidence/BL-1486-bounce-20260915.md`: the documenter's merge
`4566a68955` (`Merge hardender 6cf853db7f into documenter.`) resolved a
conflict on `backlog/standing-reds.tsv` by keeping its own side, re-adding
the six register rows the cleaner's `81a1ed3ec3` had removed. Verified on
this seat, independent of QA: parents `61a4e2e5f1` + `6cf853db7f`, base
`228a4b6b3d`; `git diff -U0 228a4b6b3d 6cf853db7f` removes base lines
33-38; `git diff -U0 228a4b6b3d 61a4e2e5f1` touches base 39 (BL-1569 row
removed) and 40 (BL-1495 row added) only - ADJACENT, DISJOINT ranges;
`git diff 61a4e2e5f1 4566a68955 -- backlog/standing-reds.tsv` is empty;
`git diff 6cf853db7f 4566a68955 -- backlog/standing-reds.tsv` is +6 rows.
One merge in the hop (`git rev-list --merges 6cf853db7f..038ba762a9`).

Why no gate spoke, each read on this seat: BL-1213's
`parcel_rollback_guard_lib.bb` is bounded to the received commit's own
`diff-tree` paths (6cf853db7f never touched the register) AND fires only on
a tip blob byte-identical to the pre-parcel blob (the tip carried main's
edits too); BL-1242/1341's `check_merge_deletion.sh` is a merge-in-progress
hook for path DELETIONS; BL-1098's push-sweep predicate asks whether main's
tip holds content no commit authored (the merge authored it); BL-1205 is
mass deletion; the BL-1472-1474 land guards diff against main, and the
cleaner's removal was never on main. The only defence is the prose
guardrail "diff every merge against BOTH parents" - and 57 files under
`backlog/evidence/*bounce*.md` name a merge that reverted something
(`grep -liE 'merge.{0,40}revert|revert.{0,40}merge'`).

Minted **BL-1576** (`type: defect`, `severity: high`): the git_handoff send
refuses a merge between the received and forwarded commits that dropped a
hunk one side had the only claim to; contested (overlapping) hunks stay the
resolver's; a `This reverts commit` excuses; warn-and-send on unreadable
facts; a read-only CLI so QA can run the predicate on the live objects.
Seven scenarios (one outline of five rows). Feature linted; IR-DRY run and
adjudicated in the ticket's `notes:`.

## The second action - BL-1568's bounce is a BL-990 case

Timeline (UTC, from the lifecycle ledger and git): coder note "BL-1568 case
04 also red" 00:12:35Z and forward ~00:13Z; cleaner 00:14-00:15Z, architect
00:16-00:17Z, hardender 00:18-00:21Z, documenter 00:22-00:25Z; specifier
amendment `c1c675af80` 00:31Z (01:31 BST); specifier note to CODER
`00_20260915T003239Z_001548` 00:32Z; QA received 00:33Z; bounce recorded
00:35:10Z blaming coder.

QA's bounce evidence charges the coder on the premise that "the amendment
landed on main before this parcel reached cleaner/architect/hardener/
documenter". That premise is false by six minutes: the amendment landed
after the documenter had finished and two minutes before QA received. My
own amendment evidence (`backlog/evidence/BL-1568-specifier-amendment-
20260915.md`) ruled "The omission is the mint's; no bounce is recorded
against the coder" - case 04 was red at mint for a spec-level reason (the
test exercised a note form production no longer counts as a trail) that
needed a ruling (BL-1573), which the coder correctly raised by note and
could not have resolved alone. My note went to the rebuild role, not the
holder - the "assigned_to is not the holder" miss - so QA never saw the
amendment context and charged the coder. The rebuild itself was right;
the attribution was not. Recorded with `record-bounce-correction.js`
(`--ticket BL-1568 --commit 1f92d0bf8a --by specifier`), append-only; the
original line and the parcel's disposition are untouched.

## Signals I looked at and did not act on

- **QA dwell 77 min.** Four full-suite sweeps (10479 unit + 1194 property
  tests per BL-1486 pass, twice) plus the Article 4.2 hold on BL-1569's
  parcel that BL-1566 (09-14) already owns. Per-parcel minutes; no ticket.
- **Cleaner chase x4.** One per ticket, each at the coder->cleaner rotation
  (queueWait 99-498 s), none of the 09-14 helper-hunting shape (zero
  root-level `./ready_for_next.sh` attempts after hotfix 1fc9065605).
  Down from 10 (09-14) and 7 (09-13). Rotation boot latency; no ticket.
- **`qualityRecommendations`** lower x1 / raise x5: advisory.
- **Determinism candidates** `pass-bounce-evidence` (0.024),
  `backlog-promotion` (0.201): still no open `ritual_class:` declarant
  (BL-1479 declared `backlog-promotion`, in `done/M8/`). BL-1576 touches
  neither ritual's scripting, so it does not declare a class - a false
  declaration would only hide it. Not ticketed, same reasoning as the
  09-08..09-14 passes; expect both again.
- **Uncommitted edits on the shared checkout at boot**, not mine and not
  swept: `backlog/hotfix-ledger.yaml` (two rows flipped to
  `awaiting-human`, the ledger sweep's own write) and the tracked
  `swarmforge/runtime/handoff-draft.txt` deleted (consumed by a send).
  Surfaced here for the coordinator's step 0; left untouched.

By specifier.
