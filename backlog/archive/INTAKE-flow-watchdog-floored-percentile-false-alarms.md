# Raw intake — Flow-watchdog floored percentiles fire WARN on healthy in-flight hops

Status: new intake, minted as **BL-835** (human via Cursor 2026-08-06 ~20:16
CEST). **Live noise from the hot-synced adopt sitting ticket-less in
`swarmforge/scripts/`** — not a greenfield design ask.

Related (do not conflate)
- **BL-827** (paused, approved) — adopt the spec-dependent percentile work.
  Its feature scenario 01 currently *requires* early fire below the global
  warn. Live evidence says that process rule is wrong when calibration is
  floored. Specifier: amend BL-827 after this lands (or fold the contract
  change into this parcel if BL-827 has not started).
- **BL-650** (paused) — active-time clock. Different subject; does not stop
  1-minute floored WARNs on fast hops that are being worked.
- **BL-779 / BL-780** — pause-blind / note-actionability siblings; leave alone.

## Goal

1. Specifier mints / confirms a **high** defect: calibrated warn must not be
   invented by flooring a sub-floor percentile. When raw p67 is below
   `min-warn-ms`, discard that key and fall through (`*->to|type` → global),
   instead of emitting `warn-ms = 60000`.
2. Fix the stale `flow_watchdog_lib.bb` comment that still claims fallthrough
   includes `*->*|type` (resolution correctly skips it; docs already say so).
3. Acceptance must prove the live failure mode: a route whose history is
   mostly sub-minute must **not** WARN a 90s in_process parcel that the old
   global 15m pair would have left quiet.
4. Queue-jump / ambulance — human asked for ASAP; the running daemon is
   already emitting these alarms from hot-synced scripts.

## Live evidence (verified 2026-08-06)

### Observable symptom

From `.swarmforge/daemon/handoffd.log` after the percentile table came up
(`.swarmforge/daemon/flow-watchdog-thresholds.json`, 544 samples,
calibrated ~15:19 local):

```
WARN flow-stall: … (architect->hardender, git_handoff) aged 24m   # calibrated ~24.6m — good
WARN flow-stall: … (hardender->documenter, git_handoff) aged 12m  # calibrated ~11.6m — good
WARN flow-stall: … (QA->coordinator, git_handoff) aged 1m         # floored — bad
         in coordinator in_process - investigate.
```

Morning alarms were still flat 15m. Afternoon pipeline hops look right.
`QA→coordinator|git_handoff` (and siblings) are worse than before.

### Root cause (measured, not inferred)

`thresholds-from-samples` does:

```clojure
warn-ms (max min-warn-ms (long warn-raw))   ;; min-warn-ms = 60000
```

Live table rows floored at 60s (source=exact):

| key | warn | escalate | n |
|---|---|---|---|
| `QA->coordinator\|git_handoff` | 60s | 9.0h | 11 |
| `coder->coordinator\|note` | 60s | 4.5m | 43 |
| `specifier->coordinator\|note` | 60s | 26.4m | 38 |
| `*->coordinator\|git_handoff` | 60s | 9.0h | 11 |

So any parcel that sits ~1 minute on those hops crosses WARN — including
healthy `in_process` work with a live session. The floor was meant to stop
sub-minute clock noise; instead it **publishes a fake percentile** and the
watchdog trusts it.

Process bug in one line: **floor ≠ calibrate**. A sample set whose p67 is
below the floor has not earned a calibrated threshold; inventing one by
clamping is how fast hops spam OPERATOR.

### Why BL-827's current contract is part of the problem

BL-827 scenario 01 and its feature intro endorse alarming *before* the global
warn on fast routes. That is the right idea when p67 is a real residence
(e.g. 12m / 24m). It is the wrong idea when p67 is 3 seconds and the code
floors to 60s. This intake revises the process: stricter-than-global is
allowed only when the raw percentile itself clears the gate.

## Specifier ask

Mint (or confirm BL-835) a defect that:

1. Changes `thresholds-from-samples` / `build-threshold-table` so a key whose
   raw warn percentile is `< min-warn-ms` is **not emitted** (fall through),
   rather than emitted at the floor. Escalate-above-warn and the global
   fallback stay as they are.
2. Optionally raises `min-warn-ms` if the human wants a stricter gate than
   60s — but the reject-vs-floor change is the mandatory process fix; raising
   the number alone still invents thresholds.
3. Fixes the stale fallthrough comment at the top of the percentile section
   in `flow_watchdog_lib.bb` (still says `*->*|type`; resolution does not).
4. Extends `flow_watchdog_test_runner.bb` with a regression: sub-floor sample
   set → no exact-key entry → resolve falls through → a ~90s parcel does not
   WARN under global 15m.
5. Notes the BL-827 contract amend (scenario 01 must not require early fire
   when the only calibrated candidate was floored / rejected).

Out of scope: BL-650 active-time clock; changing unsuppressable posture;
re-adding `*->*|type` into resolution; the adaptation-hazard ceiling (BL-827
human call (a)/(b)/(c)).

## Human urgency

Human: write the intake and get the swarm to implement ASAP. Live OPERATOR
topic is already taking 1-minute WARNs from floored rows. Ambulance +
promote after mint.
