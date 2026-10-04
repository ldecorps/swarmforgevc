# Closing-ceremony lean pass — shift 2026-10-04

By specifier. The packet is `.swarmforge/lean/ceremony/2026-10-04.json`.
The coordinator's note 016224 was held by the ceremony's own control pause,
so this pass ran from the held file.

Recorded outcome: `process_ticket`, ref `BL-1949`.

## 1. The packet is empty, and the night was not

`pathTaken`, `dwellHotspots`, `bounceClasses`, `skipReasons`, `stalls` and
`hypotheses` are all `[]`. Only `determinismCandidates` has entries. Two
things empty it:

- **The fold window (BL-1456, active, assigned to coder).** The run folds
  only ledger events dated with its own UTC day. `.swarmforge/lean/2026-10-04.jsonl`
  does not exist. The 755 events in `2026-10-03.jsonl` after the 10-03 run
  (07:12Z) reach no packet. This is the BL-1456 defect again, already
  owned and in flight. No new ticket.
- **The ledger writes when a ticket closes.** The last event is
  2026-10-03T21:49Z. No ticket closed after that, because the iq3 coder
  held BL-1858 for about 11 h. The chaser telemetry did record the stall:
  286 `chase`, 6 `respawn` and 15 `claim-idle` records from 22:00Z. But
  `composeStallEvents` (`extension/src/metrics/leanLedgerComposeStall.ts`)
  takes its ticket windows only from *completed* handoffs, so a hold that
  has not closed has no window and attributes to no ticket. Once BL-1456
  folds by append time, those stalls reach the first packet after the held
  ticket closes. That is late, but not lost. The live stall signal is
  handoffd's claim/reclaim path, not this packet. No new ticket.

## 2. The shift's bottleneck and its fix

The bottleneck was BL-1858, held by the iq3 coder for about 11 h with
nothing forwarded. Every qwen compaction, about one every 4 minutes and
about 80 % of model time, was cut at the 4096-token output cap before
`<next_step>`. 0 of 24 snapshots closed, so each session re-read the same
files.

- **Fix:** hotfix 380481d3be, a qwen PreCompact hook that puts
  next_step/current_work/pending_tasks first and stays under the cap.
- **Stamp-off:** BL-1949, minted ead08b7bac and queue-jumped 6c43ab2137.
  It is the recorded outcome.
- **Live check:** two sessions after the hotfix (06:29Z, 06:59Z) each rode
  several compactions and resumed real work after every one.

A second contributor has no ticket. It is recorded here for the human, not
minted. The human's answer to the relayed BL-1858 fork ("Pull BL-1858 off
iq3, let it keep going on something else") sat unsubmitted in the
coordinator pane's input box for about 6 h 25 m. The provenance of a typed
line in a pane cannot be checked from the pane, so a spec would rest on
guesses.

## 3. Determinism candidates: `no_change` for this half

| class | dominance | top subject (count) | reason |
|---|---|---|---|
| `pass-bounce-evidence` | 0.037 | `BL-1850: documenter review pass evidence (NONE)` (250) | One evidence file per ticket and stage is by design; the subjects vary because the ticket id leads. No open ticket declares the class, so it is offered again. |
| `backlog-promotion` | 0.223 | `Promote BL-1929: paused → active for coder` (788) | Promotion is already scripted (`promote_and_route_next.sh`); the rest of the class is specifier amendments in flight, which are judgement work. |

The same two classes have been offered every night since 2026-09-30.
Repeating them is the intended fail-toward-firing behaviour.

## 4. Shift-end consolidation sweep

The batch was the 36 open tickets whose notes read `Minted 2026-10-03` or
`Minted 2026-10-04`. The 10-03 run came before most of 10-03's mints, so
none of these had been swept.

### One merge, N:1 into BL-1920

BL-1919 (0d44613b74) and BL-1923 (59a376845a) were absorbed into BL-1920
(0eb5958ab6).

- **Shared:** one root cause (the seat announces an action and calls no
  tool), one file (`local_model_tool_call_shim.py` and its unit file), one
  acceptance (BL-1052's feature), one test script, one invariant.
- **Why BL-1920:** BL-1923 already depended on BL-1920's architect pass,
  because it only added words to the heuristic that pass reviews.
- **Size:** about 126 lines of shim diff, reviewed in one sitting.
- **Saved:** two local-coder sessions and two QA passes.
- **Article 5.3:** every human sentence was quoted identically in all
  three tickets and survives in BL-1920. The specifier's observation lines
  and both absorbed tickets' notes are carried over verbatim.
- **Housekeeping:** the absorbed tickets moved to `backlog/done/M8/` with
  `status: superseded` and `closed_as: superseded-by-BL-1920`. Their
  hotfix-ledger rows now name BL-1920. BL-1925's `depends_on: [BL-1920]`
  is unchanged. Neither absorbed ticket owned a feature file, so nothing
  was left as a tombstone.

### Reasoned non-merges

- **BL-1924 + BL-1927:** both are the served-parcel text in `handoff_lib.bb`
  print-task. Together they are 5 SHAs across `handoff_lib.bb`,
  `parcel_line_lib.bb`, `ready_for_next_task.bb`, `swarmforge.sh` and a
  property test, plus BL-1924's documenter pass. That is not one sitting
  for the local coder seat that just took 11 h on BL-1858, and
  `depends_on` already orders them.
- **BL-1925:** the nudge on a question touches BL-1920's mechanism. Its
  other two SHAs are the served ticket path and the tool list. Folding it
  in would give BL-1920 6 SHAs over three mechanisms. It stays as a
  dependent.
- **BL-1926:** several text calls where only the first runs. That is a
  different root cause (multi-call parsing), and it also changes the card.
- **BL-1918:** the kickoff text, with a different acceptance (BL-1837).
- **BL-1929, BL-1934, BL-1936, BL-1949, BL-1931..BL-1933:** active, never
  consolidated (in flight).
- **BL-1935:** the deferred Stryker pass, a different gate and stage.
- **BL-1939..BL-1948:** a deliberate 1:N split of the BL-1937 census. Each
  binds different features.
- **BL-1913, BL-1914, BL-1915, BL-1928** (landing-is-a-merge): four
  separate mechanisms.
- **BL-1909, BL-1911, BL-1922, BL-1930, BL-1937, BL-1938:** no overlap.

## 5. Measured at the merge, HEAD 70adf59960

- `bash swarmforge/scripts/test/test_bl1917_local_model_seat_url.sh`:
  ALL PASS, 1.5 s. Its case 0 runs the shim's 31 unit cases.
- `node specs/pipeline/cli.js specs/features/BL-1052-a-role-seat-can-be-staffed-by-a-downloaded-local-model.feature`:
  9 of 9 pass.
- All three hotfix SHAs are ancestors of HEAD.
