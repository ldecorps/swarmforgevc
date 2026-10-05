# Closing-ceremony lean pass — shift 2026-10-05 (the 2026-10-04 evening)

By specifier. The packet is `.swarmforge/lean/ceremony/2026-10-05.json`.
The coordinator's note 016426 was held by the ceremony's own control pause
(`ready_for_next.sh`: `SKIPPED pause-hold`), so this pass ran from the held
file.

Recorded outcome: `process_ticket`, ref `BL-1980`.

## 1. The packet is empty, and the shift was not

`pathTaken`, `dwellHotspots`, `bounceClasses`, `skipReasons`, `stalls`,
`hypotheses` and `qualityRecommendations` are all `[]`. Its `deliveredAt` is
`2026-10-05T00:00:00Z`, a midnight that never happened. The run folded only
events dated 2026-10-05, and there are none: `.swarmforge/lean/2026-10-05.jsonl`
does not exist. `.swarmforge/lean/2026-10-04.jsonl` holds 421 events (276
stall, 98 stage_transition, 45 stage_skip, 2 close) that reach no packet.

This is the BL-1456 defect. It was split this shift into BL-1967 (a run
records its real window and the night path passes the real instant, not
`<date>T00:00:00Z`) and BL-1968 (the fold goes by append order). Both are
paused, approved, and owned. No new ticket.

## 2. The shift's bottleneck, read without the packet

The specifier watched it directly all evening: the iq3 coder, the only coder
seat, stalled on tickets it could not finish and stayed stalled for hours,
because the only backstop is babysitter's 180-minute seat-stuck CRIT.

| Ticket | What the seat did | Cost |
|---|---|---|
| BL-1456 | 2 compactions, 0 edits, pulled (BAU) | 18 min, split into BL-1967/1968 |
| BL-1951 | resolved a bounce that was false (stale `extension/out/`), then cycled 13 git commands, then one command until qwen's loop dialog halted it | about 1 h; rerouted by the coordinator |
| BL-1970 | read the runner's internals, then alternated two reads ~30 times each with 44 REPEAT notes, until qwen's loop dialog halted it at 22:03Z | idle from 22:03Z until the 180-min clock |

What landed or was minted this shift against it:

- Mechanisms (hotfixes, stamped off): the compaction summary names one
  next edit (`e0246ab913`, BL-1952); the edit hook names the open form of a
  broken `.bb` file (`52a004ed93`, BL-1970); the repeat guard
  (`66bd85171f`/`d19171aeb6`, BL-1971). The edit hook unstuck BL-1902 live;
  QA found the repeat guard broke no loops (BL-1971 QA, `743f9eaab6`).
- BL-1980 (the recorded ref): the seat-stuck CRIT also fires on qwen's loop
  dialog or 10 REPEAT notes since the claim, so the coordinator's
  pull-and-restart BAU runs in minutes. Replayed on BL-1970's session: the
  10th note lands at 21:58Z, against 00:50Z for the dwell clock.
- BL-1979: a feature file scaffolds its own step handler - the capability
  BL-1970's stall showed missing.
- BL-1972: a direct `npx vitest run` on a stale build stops before any
  test - the cause of BL-1951's false bounce.

## 3. Shift-end consolidation sweep

Read as one batch: every paused or active ticket whose notes say it was
minted or split on 2026-10-04 (BL-1939..BL-1948, BL-1952..BL-1969,
BL-1972..BL-1980). No two share a root cause.

One pair shares a fix shape: BL-1962 (on a deterministic pack, swarm ensure
never respawns the coordinator) and BL-1969 (swarm ensure leaves a
GPU-quiet local-model seat down) both add a "leave this seat down" rule
ahead of the respawn in `swarm_ensure.bb`'s per-role loop. Not merged:
BL-1962 is a slice of the human's top-priority deterministic-coordinator
epic, cut to the iq3 seat's envelope, and a merge would cross epics and
grow it. Both carry a note now: whichever lands second extends the first
one's rule rather than adding a second branch. Concurrent Work
Orthogonality already keeps them from running at the same time.

## 4. Determinism candidates

- `pass-bounce-evidence` (dominance 0.038): `no_change` for this class. An
  evidence file's body is the reviewing role's judgement, item by item;
  what is mechanical in it (the header, the commit, the gate table rows)
  is a small part, and BL-1365's own ruling keeps a candidate as evidence,
  never a ticket by itself. Expect it offered again.
- `backlog-promotion` (dominance 0.22): `no_change`. Promotion is already
  run by a script (`promote_and_route_next.sh`), and the deterministic
  coordinator epic (BL-1931's slices BL-1958..BL-1960, BL-1846) moves the
  remaining hand step into handoffd. A ticket here would duplicate that
  epic. Expect it offered again until one of those slices declares
  `ritual_class: backlog-promotion`.
