# Closing-ceremony lean pass — shift 2026-10-07 (the 2026-10-06 day)

By specifier. The packet is `.swarmforge/lean/ceremony/2026-10-07.json`
(window 2026-10-06T00:00:32Z to 2026-10-07T00:00:32Z, 1003 ledger events).
The coordinator's notes 017183 and 017184 (the same packet twice) were held
by the ceremony's control pause (`ready_for_next.sh`: `SKIPPED pause-hold`),
so this pass ran from the held file.

Recorded outcome: `process_ticket`, ref `BL-2024` (re-prioritized 20 -> 3).

## 1. The hotspot: QA, a second shift running

| Shift | QA processing | Next role |
|---|---|---|
| 2026-10-06 | 718 min | hardender 214 |
| 2026-10-07 | 748 min | coder@2 346 |

From `.swarmforge/lean/2026-10-06.jsonl`: 53 QA passes over 38 tickets,
median 13.4 min, p75 16.6, max 34.3; QA queue wait summed 1410 min. The
passes cover every hour the swarm was up (none 14:00-18:59Z, the VM
outage), so QA ran almost back to back.

What a pass spends, from QA's own lane logs in `.worktrees/QA/extension/`
for the same window:

| Lane | Runs | Minutes | Per run |
|---|---|---|---|
| unit (`.test-durations.jsonl`) | 59 | 48.3 | 0.6-3.1 |
| property (`.property-durations.jsonl`) | 31 | 310.7 | 6.4-17.7, rising through the shift |

The property lane is the bulk of a pass. 12 of the 38 tickets were
review-only stamp-offs (BL-1999, BL-2005, BL-2013, BL-2014, BL-2018,
BL-2029, BL-2036, BL-2040, BL-2042, BL-2047, BL-2051, BL-2053): 175 of the
748 min. A stamp-off's own diff touches only `backlog/`, so its lanes measure
main, not the parcel.

## 2. Why BL-2024 again, not a new ticket

BL-2024 was the 2026-10-06 pass's ticket for exactly this: the gather skips
both lanes for a parcel whose diff touches only `backlog/`. It is approved and
needs no ruling, but it carried `priority: 20` with the depth cap full (6 of
6) and about 22 approved non-epic tickets ahead of it (priority 3-18). So the
fix for the shift's own bottleneck had not started, and the bottleneck grew.
This pass moves it to `priority: 3`. It shares `qaGather.ts` with BL-2030,
BL-2043 and BL-2054, all paused, so orthogonality holds against the active
set (BL-1676, BL-1880, BL-1911, BL-1913, BL-2044, BL-2050).

Not ticketed: the property lane on a parcel that does change code (about
10 min a pass). BL-1877 made QA's whole-lane run the deliberate backstop once
commits began running only the property files they reach, so cutting it is a
policy question, not a defect. The measurement to watch is the per-run rise
within this shift (7.3 min early, 12-17 min late), which tracks host load.
If it persists after BL-2024 lands, that is the next pass's evidence.

## 3. Shift-end consolidation sweep

Read as one batch: every paused or active ticket whose notes say "Minted
2026-10-06" (BL-2020, BL-2021, BL-2024, BL-2026, BL-2030, BL-2031, BL-2032,
BL-2035, BL-2043, BL-2044, BL-2049, BL-2050, BL-2052, BL-2054). No two share
a root cause.

- BL-2024, BL-2030, BL-2043 and BL-2054 change one file (`qaGather.ts`) but
  each owns a different outcome (lane skip, straggler scope, row text, red
  cause) and two own different verification-debt categories. Merged, they
  would fail INVEST Small. Kept apart; orthogonality sequences them.
- BL-2044 and BL-2050 (a seat's commits on a moved parcel line; a committed
  parcel is never a no-op) are both active, and consolidation never touches
  an active ticket.
- BL-2020/BL-2021 (feature and shell front-ends) and BL-2049 (property
  runners) cover different populations.

No merge: a `no_change` for this half, folded into the outcome above.

## 4. Determinism candidates

- `pass-bounce-evidence` (6786 commits, dominance 0.039): no open ticket
  declares it. Not ticketed: `record-review-evidence.js` already writes
  these commits; the low dominance is the free-form detail in bounce
  subjects. Expect it again.
- `backlog-promotion` (3576 commits, dominance 0.23): its top subject,
  "Promote BL-<n>: paused -> active for coder" (835), is already written by
  the promotion tooling; the remainder is in-flight spec amendments. A done
  ticket declares the class; no open one does. Expect it again.

## 5. Other packet signals

- Hypothesis "2 bounces classed behavior": BL-1619 (020daac44f) and
  BL-2037 (46a708b027), both QA on the coder, in unrelated code (the
  property-lane recorder; a local seat's phase record). No shared cause.
  The shift's other two bounces were BL-1979 (unit) and BL-2034
  (acceptance).
- Stalls: QA's chase events (299 records) are the queue-wait symptom of
  section 1, not a separate defect. QA's six respawn records fall at
  01:24Z, 06:02Z, 20:06Z, 20:33Z, 21:59Z and 23:19Z; two sit right after
  the 19:38Z and 20:32Z swarm deaths (BL-2053), and the rest show no
  common cause in the ledger.
