# Consolidation sweep of the paused backlog - 2026-09-22 (specifier, on the human's ask "Can you try and consolidate the pending tickets")

Scope: every ticket in `backlog/paused/` (100 at the start of the pass:
71 slices, 29 epic trackers, across 40 epic slugs), read as one batch by
epic, by file overlap (paths named in description/constraints/wiring)
and by title similarity. Active tickets are never consolidated
(BL-317/BL-325). Article 5.3: no human-quoted sentence was dropped -
every retirement below moves a whole file, and the one edited tracker
gains a line.

## Actions taken (one commit)

1. **Five completed epic trackers closed** (moved paused -> done,
   `status: done`, `closed_as` set, a notes line naming this sweep):
   - BL-1176 agent-memory-transfer - 3/3 children done, nothing remaining.
   - BL-1180 best-of-breed-swarm - 7/7 children done, nothing remaining.
   - BL-558 github-auto-intake - 1/1 done, nothing remaining.
   - BL-594 swarm-behaviour-trends - 13/13 done, nothing remaining.
   - BL-542 model-routing sub-tracker - 1/1 done; its own notes name
     BL-1329 as the umbrella that tracks the family (BL-548, BL-712 stay
     under BL-1329) - `closed_as: superseded-by-BL-1329`.
   Nothing had ever closed a finished epic: two earlier trackers sit in
   done/ with `status: todo`. These five carried no open slice by slug.
2. **BL-1125 local-llm-swarm**: BL-1682 (paused, minted 2026-09-21)
   carries its slug but was not in `decomposes_into`; added.

## Merges considered and refused, with the reason

- **Eight "Swarm stamp-off" review tickets** (BL-1504, 1506, 1507, 1508,
  1549, 1557, 1644, 1622): one shape (certify a landed operator hotfix
  through the gates), eight distinct hotfixes. Each carries its own
  tracked feature file (3-9 scenarios, 37 together), one handler pin,
  and a `stamp_ticket` link in `backlog/hotfix-ledger.yaml`.
  `acceptance:` is one path (schema line 27), so a batch would need one
  merged feature of 20-37 daemon-fixture scenarios - past "a sharp
  handful" and, since the Gherkin mutation gate re-runs the whole feature
  per mutant (BL-1358 ceiling, BL-1541), likely untestable in the
  acceptance lane - plus eight ledger re-links. Kept separate; they are
  all low-cost review-only parcels and can be promoted in a row.
- **BL-1531 / BL-1532** (Approvals-topic ruling ask: lettered options with
  trade-offs; a typed `approve <id> <letter>`): one human directive,
  split 1:2 at intake on 2026-09-11 with `depends_on: [BL-1531]` on the
  second. Sequential by design (compose, then parse), 6 + 6 scenarios,
  different files. The split is doing its job; merging would only make
  one 12-scenario parcel.
- **BL-1561 / BL-1562** (the ready_for_next.sh path incident): 1562
  removes the cause (every nudge names the worktree-relative path from
  one constant), 1561 narrows the heal (rewrite only in command
  position). Different mechanism, different file; the 09-20 precedent
  (BL-1664/1665/1666: the production side of a race stays with its guard).
- **BL-1456 / BL-1551** (both feed the closing-ceremony packet): the fold
  window versus the meaning of a respawn telemetry row - different code.
- **BL-1596 / BL-1619** (property-lane timeouts): a sweep of 81 bare
  numeric per-test timeouts versus the lane's own duration measurement;
  different deliverables, the second is the human's 2026-09-17 intake.
- **BL-1644 / BL-1690** (the freshness cron): 1644 reviews the PATH
  export in `finish-shift` and `wait_for_expedite_then_bedtime.sh`; 1690
  changes the checker's interpreter and the composed cron line.
  Different files.
- **BL-1688 / BL-1689**: the storm's bound versus the second supervisor;
  deliberately split on 2026-09-22 (see BL-1688's notes).
- **BL-1672 / 1674 / 1675 / 1676** (first-run survivors per file under
  BL-1519): one shape, one file each, each a sitting by its own census;
  any two merged fail INVEST Small (the 2026-09-10 rule).
- **BL-836 / 837 / 838** (Bubble question sheet) and **BL-842 / 843**
  (Bubble Control): declared sequential slices with `depends_on`.

## Retirements considered and refused

- July/August feature slices (BL-548, 553, 555, 569, 793, 836-838,
  842-843, 940, 1270): approved, dependencies landed or declared, no
  landed successor supersedes any of them (searched done/ by
  mechanism). They are dormant because STEERING.md has declared no
  direction since 2026-07-13; that is the human's choice to make, not a
  reason to retire.
- BL-101 (headless secondary swarms): `status: blocked`, parked in
  paused on the coordinator's 2026-07-19 note for human hardware
  verification only. Left exactly as parked.

## For the human: dormant epic trackers (a question, not an action)

Sixteen trackers have every minted child landed and `remaining_slices`
that nobody has minted for three weeks or more: BL-1013, 1165, 1168,
1172, 1417, 540, 659, 667, 712, 776, 824, 830, 862, 865, 899, 981; three
more have never had a child (BL-564 spec-drift, BL-645 stereo-router,
BL-770 workflow-canary). Closing them retires product intent the human
approved, so this pass only lists them. Two dispositions are possible
per tracker: keep (the remaining slices are still wanted and will be
minted when the direction picks them) or hold (move to backlog/hold/ so
they stop reading as pending). A ruling on the list, even "hold all
nineteen", would take the paused queue from 95 to 76.

## Observed, not fixed

- `bb swarmforge/scripts/backlog_epic_milestone_audit.bb` FAILs today with
  `EPIC-WIRING-MISSING` on several Bubble epic trackers (BL-774, BL-776,
  BL-824, BL-862 among them) - pre-existing before and after this sweep,
  none of them touched here; the audit's own rule text was not read in
  this pass.
- Hotfix 9237008e9f (2026-08-30, the 75% context-clear rule) has no
  stamp ticket and no ledger row (noted to the coordinator earlier
  today).

By specifier.
