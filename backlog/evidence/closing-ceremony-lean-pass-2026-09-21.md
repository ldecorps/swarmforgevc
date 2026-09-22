# Closing ceremony lean pass - shift 2026-09-21 (specifier)

Packet: `.swarmforge/lean/ceremony/2026-09-21.json` (delivered
2026-09-21T17:25:28Z, `outcome: null`, `failedAt` at midnight), brought
by the coordinator's note 010685 on 2026-09-22 07:11Z ("ended with NO
outcome - FAILED"). Outcome recorded with
`closing-ceremony-outcome.js --shift 2026-09-21 --outcome process_ticket --ref BL-1688`.

## Packet, read

- Path taken: coder@2, cleaner, architect, hardender, documenter, coder,
  QA. Dwell: QA 16,572 s (4.6 h), hardender 11,106 s, coder@2 5,170 s,
  coder 4,843 s, documenter 4,420 s, architect 4,047 s, cleaner 3,935 s.
- Bounces (`.swarmforge/lean/2026-09-21.jsonl`, source bounce-store):
  behavior 4 - BL-1640 (QA -> coder), BL-1641 (architect -> coder),
  BL-1641 (QA -> coder), BL-1658 (cleaner -> coder); unit 1 - BL-1458
  (QA -> hardender).
- Stalls: coder@2 chase 53, nudge 1; QA chase 46, nudge 4, respawn 1;
  coder chase 30, nudge 1; hardender chase 5; cleaner chase 1; architect
  chase 1.
- Hypotheses: QA dwell; the behavior class recurring; the coder@2 chase
  pattern. Determinism candidates: `pass-bounce-evidence` (dominance
  0.038), `backlog-promotion` (0.214). Quality dials: the coordinator's
  half.

## Outcome: process_ticket - BL-1688 (with BL-1689 and BL-1690)

The packet's own three hypotheses are each owned or explained below;
the unowned finding of the shift is outside the packet's fields, in the
daemon directory it does not fold. The ceremony's sleep path stopped the
swarm on purpose at 16:35:28Z (`closing-briefing-missing`, `supervisor
stopped`, `kill_all_swarm` 16:35:31-34Z clearing the tmux socket and
writing BL-785's marker). From 16:35:35Z to 17:19:36Z the BL-1492
restart-in-place ladder invoked `start_handoff_daemon.sh` 334 times
(`daemon-start-audit.log`, `caller=build_freshness_cli`, two per ~15 s),
each attempt crashing handoffd's `-main` on the missing
`.swarmforge/tmux-socket` (`java.io.FileNotFoundException`,
`handoffd.bb:5439`) and leaving a failure report (325), a rotated log
(334) and a restart alarm handed to the email adapter; the budget of two
per 600 s never tripped because no failure report ever carried more than
one `restart_history` entry (166 `nil`). Cause: the start owner erases
every deliberate-stop signal on every invocation - `freshness_clear_stopped
handoffd` (line 54), `rm -f daemon/stop` (line 91) and a rewrite of
`handoffd.status.json` without its history (lines 93-95) - so the marker
the kill wrote could not hold it and the budget's memory is erased by
the thing it bounds. Two supervisor processes survived the kill with
their pid files gone (`postmortem-20260921T163534Z.log`; two interleaved
heartbeat series in `handoffd-supervisor.log`), because
`kill_pipeline_swarm.sh`'s stray reaper excludes `handoffd_supervisor`
(line 235) and the start owner's idempotence stops pid-file owners only.
The loop ended with a second `kill_all_swarm` at 17:17:29Z.

- **BL-1688** (defect, high, auto-approved): a heal-path start refuses
  while the marker stands, only a deliberate launch clears the signals,
  the ledger survives every writer, a missing socket is a supervisor
  skip and a daemon refusal.
- **BL-1689** (defect, medium, pending): the pipeline kill and the start
  owner reap every supervisor whose command line names their root.
- **BL-1690** (defect, medium, pending), found reading the same
  directory: the BL-675 cron line runs the checker under `/bin/sh` while
  it sources the operator's bash `swarm.env` - `[[: not found` 9,708 times
  in a 13,306-line log since 2026-07-28, and the guards evaluate
  backwards under dash.

The 2026-09-19 memory of the same ceremony stop (babysitterd resurrected
by the `*/2` cron because the `kill_all_swarm.sh` shim never writes
babysitterd's marker) ended in "candidate mint" and was never ticketed;
BL-1688 is the handoffd half, where the marker IS written and erased.
The babysitterd half stays an observation until it recurs with a census.

## The packet's hypotheses, one by one

- **QA dwell 4.6 h.** Twenty tickets closed on 2026-09-21 (`git log
  origin/main --since 2026-09-21 --until 2026-09-22 | grep '^Close BL-'`:
  BL-1458, 1467, 1516, 1630, 1638, 1640, 1641, 1657, 1658, 1661, 1664,
  1666, 1667, 1668, 1670, 1671, 1677, 1678, 1680, 1683), about 14 minutes
  of QA per land. That is throughput, not a stall; the land recipe's
  tip-pure replays (three for BL-1641, each overtaken by a push) are
  owned by BL-1679, the entangled-sibling escalation on BL-1640 was
  adjudicated the same day, and the QA.prompt one-run rule from the
  09-20 pass is in force. No change.
- **Behavior x4.** Four bounces, four causes, no shared root: BL-1640 a
  CWD-derived conf path in the ceremony CLI (fixed in the parcel, landed);
  BL-1641 a fail-open `catch` (architect, fixed) and then a forward whose
  lineage skipped that fix (QA; the land-replay ref leak, BL-1679 owns);
  BL-1658 the coder built against the pre-amendment contract (my
  amendment timing, corrected in the store on 09-21 per BL-990) plus a
  single-sample wall-clock assertion in scenario 01 that the same file's
  scenario 02 already did best-of-three (cleaner D2). The one spec-side
  lesson is the sampling, which is now a rule in specifier.prompt (below).
- **coder@2 chase 53.** `.swarmforge/telemetry/chaser-2026-09.jsonl`: the
  chased items were coordinator Work notes (10:10Z, 13:13Z) and a cleaner
  bounce (10:04Z) queued in coder@2's `new/` while it was serial on
  BL-1640 then BL-1658 in `in_process/` - the queued-behind-a-serial-seat
  shape; zero respawns (BL-1652 landed 09-20). The rows are transport
  pokes composed as stalls; BL-1551 (paused) owns the ledger side. No
  change.
- **QA respawn 1.** 11:31:31Z on BL-1666's parcel, `busy:false
  liveness:unknown activityAgeS:72`, count 7: one respawn per sweep is
  BL-1652's design for a non-busy pane. No change.
- **Not in the packet:** the coordinator was chased 221 times and
  respawned 7 times on five dropped-parcel self-notes from 03:05Z
  (BL-1657 "no parcel in flight") during the overnight local-model run;
  that is the SUP-17 question already with the human (never nudge an
  aider coordinator), not this shift's pipeline.

## Shift-end consolidation sweep (BL-680)

Seventeen tickets carry `Minted 2026-09-21`; seven were paused at the
start of the pass (BL-1672, BL-1674, BL-1675, BL-1676, BL-1679, BL-1682,
BL-1687 - the last promoted to active during the pass), three active
(BL-1673, BL-1684, BL-1685), seven already closed (BL-1671, BL-1677,
BL-1678, BL-1680, BL-1681, BL-1683, BL-1686). Read as one batch, pairwise
by file and mechanism:

- BL-1672 / BL-1674 / BL-1675 / BL-1676 share one shape (first-run
  Stryker survivors to zero, per-declaration census, BL-1519's
  decomposition) and are deliberately one file each: 76, 84, 68 and 331
  mutants, each "one sitting" by its own census. Any two merged fail
  INVEST Small (the 2026-09-10 rule: a per-function group of ~60 is a
  sitting, a per-file ticket over 900 is not). The three from BL-1640's
  hardener run already declare a promotion order. Not merged.
- BL-1685 (active) and BL-1687 are sequential by construction - the
  second is the loaders the first's substring census missed - and one is
  active, so never consolidated (BL-317/BL-325).
- BL-1679 (land scratch refs), BL-1682 (local seat briefing, a feature
  on the human's ruling), BL-1673, BL-1684: different files, different
  mechanisms.

No N:1 merge; no retirement. `no_change` for this half.

## Determinism candidates: reasoned no_change

Unchanged from the 09-20 pass: `pass-bounce-evidence` 0.038 (every
subject carries its ticket id, so no subject can dominate by
construction - the BL-1365 normalisation observation stands),
`backlog-promotion` 0.214 (`promote_and_route_next.sh` composes the top
subject, 755 of 3,532). No ticket declares either `ritual_class`; expect
both offered again.

## spec_gate_tweak made in the same pass (recorded here, one outcome)

`swarmforge/roles/specifier.prompt` gains one rule: a scenario that
asserts a wall-clock budget takes the minimum of three in-process
samples against a budget derived from a quiet-host measurement with
stated headroom, and gates the mechanism over the number where the
mechanism is what changes. Evidence: BL-1658's scenario 01 (single
sample, 400 ms) failed 4 of 8 handlers on two consecutive runs (666 ms,
557 ms) on a correct build while scenario 02 in the same file sampled
best-of-three and passed; the coder's fix was the sampling the spec had
left to chance. This is not QA's "run it N times" (capped by the
2026-09-17 rule) - the coder's step samples, QA runs once.

## Observations carried, not ticketed

- Two babysitterd processes are alive on this host at 09:00 on
  2026-09-22: pid 16130 running `.swarmforge/operator/babysitterd.sh` (a
  Jul 24 operator copy that differs from the repo script; the pid file's
  owner) and pid 19782 running `swarmforge/scripts/babysitterd.sh`
  (started 08:52, before the relaunch). Their interval is 300 s, so they
  are not BL-1688's 15-s callers, but two heal loops on one root is the
  same class as BL-1689. Surfaced to the coordinator by note; a ticket
  waits for a census of what each one does twice.
- BL-1458's unit bounce: the hardener added a Babashka runner without
  running the `npm test` baseline that `tempDirTrapGuard` lives in;
  `hardender.prompt` line 2558 already names that baseline. No new rule.
- BL-1682 records real feature code drafted on the shared master
  checkout by the operator; the 09-21 disposition captured it as a
  patch, and today's `git status` still shows the same ten modified
  `extension/` files plus untracked packs and evidence. Not mine to
  sweep; named in the note to the coordinator.

By specifier.
