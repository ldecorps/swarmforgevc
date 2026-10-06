# Closing ceremony 2026-10-06 - specifier lean pass

Packet: `.swarmforge/lean/ceremony/2026-10-06.json` (window
2026-10-05T00:00Z..2026-10-06T00:00:32Z, 613 ledger events). The two
coordinator notes carrying it (016851, 016852) were held by the ceremony
pause; the pass ran from the packet file.

Outcome: `process_ticket` BL-2024.

## Top dwell hotspot: QA (43053407 ms)

From the packet's QA `stage_transition` events: 51 tickets passed QA,
10.3 h of queue wait and 12.0 h of processing in all.

| kind (by title) | tickets | queue wait | processing | processing / ticket |
|---|---|---|---|---|
| stamp-off | 23 | 5.3 h | 5.4 h | 14 min |
| other | 25 | 4.4 h | 5.9 h | 14 min |
| handler / test-side | 3 | 0.5 h | 0.6 h | 12 min |

Twelve QA gather reports dated 2026-10-05
(`.worktrees/QA/tmp/BL-*-gather.json`): unit lane 0.6-0.8 min, property
lane 6.6-8.2 min, on every pass. A stamp-off parcel's own diff is the
coder's review evidence under `backlog/`, so those two lanes measure main,
not the parcel. BL-2024 has the gather report both rows `skipped` for such
a parcel, failing closed on any other path. At this shift's rate it saves
about 23 x 8 min = 3 h of QA processing, plus the queue behind it. It is
minted `human_approval: pending` because it changes what the last gate
measures.

177 QA chases (`stalls`) are the chase sweep noticing parcels queued
behind a busy QA; they are the queue, not a separate defect.

## Shift-end consolidation sweep

Open tickets whose notes read "Minted 2026-10-05" or "Minted 2026-10-06":
19. The only same-fix-shape pair, BL-2002 / BL-2003 (step handlers onto
`makeAcceptanceGateDeps`), was split 1:2 on purpose this shift so each
half fits a local seat; re-merging would undo that. The stamp-offs BL-2014
and BL-2018 have different root causes (tmux exact targets vs two stale
fixtures). No merge.

## Determinism candidates

- `pass-bounce-evidence` (dominance 0.038): review evidence is already
  written by a tool (`record-review-evidence.js`); the low dominance is
  each subject carrying its own ticket id, not hand-written rituals. No
  ticket.
- `backlog-promotion` (dominance 0.23): promotion commits are already
  scripted (`Promote BL-<id>: paused -> active for <role>`, 826 of 3579);
  the rest are in-flight amendments, which are judgment. No ticket.

By specifier.
