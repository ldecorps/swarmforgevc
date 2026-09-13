# Closing ceremony — shift 2026-09-12 (specifier lean pass, BL-820)

Packet: `.swarmforge/lean/ceremony/2026-09-12.json`, `deliveredAt`
2026-09-12T00:00:00Z. Reached the specifier only as the coordinator's
priority-00 note of 2026-09-13T04:25:49Z "Closing ceremony 2026-09-12
ended with NO outcome — FAILED" (`00_20260913T042549Z_008080`), after the
2026-09-13 ceremony had already finalized the run
(`failedAt: 2026-09-13T00:00:00Z`).

**Outcome of record: `process_ticket`, ref BL-1528 — recorded HERE, not in
the store.** Verified 2026-09-13: `closing-ceremony-outcome.js --shift
2026-09-12 --outcome process_ticket --ref BL-1528` answers
`ceremony run for shift 2026-09-12 is already failed, refusing to
overwrite`. Same disposition as the 2026-09-09 pass
(`closing-ceremony-2026-09-09-specifier.md`), which minted BL-1528; this
pass amends BL-1528's `notes:` with the recurrence instead of minting a
second owner. Not a silent ceremony: this file plus the ticket amendment
are the pass's durable outcome.

## Why the packet never arrived — third occurrence, new cause

The 2026-09-12 night ceremony started 2026-09-12T04:26:00Z
(`startedAtMs` 1789187160692, `nightKey: 2026-09-12`). Its sequence reads
`freeze-promotion, no-shift-since-last-ceremony, empty-outcome-recorded,
swarm-stopped`. The `record-empty-outcome` action calls the same
`runClosingCeremony`; the packet was NOT empty (QA dwell 8387610ms on
BL-1544, one nudge + one chase), so the run was written `pending` and the
packet note was sent — and refused:

```
2026-09-12T04:25:29.059796403Z closing-ceremony-run-error exit=1 Fatal error:
  Command failed: swarmforge/scripts/swarm_handoff.sh /tmp/closing-ceremony-note-9263-byok0bg4xi.txt
```

The draft lived under `os.tmpdir()`; BL-1518-a's fail-closed root guard
(landed 2026-09-11) refuses a draft outside the project root. This is
precisely the "new cause" BL-1537 named for its senders 5–7 ("the
shift-close and 05:00 ceremony notes (the BL-1528 'ceremony note
undeliverable' shape, by a new cause)"). BL-1537 landed on `main` the same
day (`e300226fae`, `draftPathUnder(root, prefix)`; closed 2026-09-12
12:32Z) but after the 04:25Z run, and the daemon that ran the ceremony was
the 04:16:50Z start on pre-fix code. The 2026-09-13 ceremony's packet
note (`00_20260913T042550Z_008081`) was queued normally, so the trigger is
gone on the live daemon.

What BL-1537 does not cover is the shape: the exception skipped
`writeState`, the next sweep found `already_exists`, sent nothing, wrote
the state with `empty-outcome-recorded` done, and stopped the swarm. No
coordinator send between 03:00Z and 06:00Z on 2026-09-12 targets the
specifier; no handoff anywhere cites `lean/ceremony/2026-09-12.json`. The
run stayed `pending` for a day and was finalized `failed` by the next
ceremony, whose failure note reached a specifier that can no longer record
against it. That is BL-1528's defect, verbatim (title: "any non-zero
exit"), now observed on 2026-09-07 (tmux inject), 2026-09-09 (absent
recipient) and 2026-09-12 (root guard). BL-1528 is `paused`,
`human_approval: approved`, `severity: high`, `priority: 9`; it is the
open owner and needs no re-mint.

## What the packet itself showed, and why it is not the outcome

Path taken cleaner → architect → hardender → documenter → QA. Dwell
hotspots QA 8387610ms, hardender 1069993ms, architect 561803ms. No
bounces, no skips. Stalls: QA nudge ×1, chase ×1 (both BL-1544).
Hypotheses: QA dwell; QA nudge pattern.

- **The packet is a four-hour sliver.** `eventsForShiftKey` folds only
  events stamped 2026-09-12 and the run happened at 04:26Z, so the packet
  holds 2 of the day's 125 stall events and one QA parcel (BL-1544,
  transitions 01:00Z and 03:08Z). Owned by BL-1456 (`paused`, approved,
  `severity: medium`, `priority: 12`): every event folded by exactly one
  run, windows tiling the timeline, one migration run folding forward.
  Not re-minted. The `no-shift-since-last-ceremony` verdict beside a
  non-empty packet is the same window disagreement seen from the night
  gate's side; BL-1456's tiled windows remove it, so no separate ticket.
- **QA dwell 2.3h on BL-1544, 1 nudge.** QA hand-lands (BL-247); BL-1544
  closed that morning. Known shape, nothing new.
- **The unfolded 20 hours** (for the record, since no packet will show
  them until BL-1456's migration run): QA chase ×60, nudge ×8, respawn
  ×12; cleaner chase ×16, respawn ×5; architect/hardender/documenter
  chase ×7 each; coder chase ×1. The QA burst 15:26Z–15:44Z on BL-1546
  is one event per ~38s daemon sweep (`chase-rotate-seated-preferred-yield
  QA specifier`, `wake-dedup-skip QA unchanged-mailbox`) while QA was
  resident 14:18Z–16:16Z hand-landing BL-1546 (landed `1c6c0f9012`
  16:12Z, after BL-1537's own hand-land). The `respawn` rows carry the
  chaser's cumulative counter, not distinct respawns. Chase cadence on a
  long hand-land is the known mono-router shape; the 2026-09-12 QA-resident
  menu incident is already the coordinator's role_ask (topic 1602) and is
  not duplicated here.
- **`qualityRecommendations`** (lower ×4 on stage_transition, raise QA on
  stalls): advisory; the coordinator's half.
- **Determinism candidates** `pass-bounce-evidence` (0.017),
  `backlog-promotion` (0.194), `backlog-closure` (0.484): the same three
  as every pass since 09-06, still no open `ritual_class:` declarant
  (BL-1479 declared `backlog-promotion` and is in `done/M8/`). Not
  ticketed, same reasoning as the 09-08/09-09/09-11 passes; expect them
  again — that repeat is the fail-toward-firing posture.

## Amendment landed with this file

`backlog/paused/BL-1528-*.yaml` `notes:` gains the 2026-09-12 occurrence
(cause, log line, BL-1537 relationship, terminal status of the run).
Notes-only: acceptance, feature file and approval are untouched.
