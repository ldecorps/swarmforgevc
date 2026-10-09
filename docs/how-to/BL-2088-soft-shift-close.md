# Soft shift close: freeze new jobs, then drain in-flight

## Background

Scheduled bedtime used to hard-kill every seat at the shift-end bell
(`wait_for_expedite_then_bedtime.sh` → `./finish-shift`), with only an
in-flight expedite run waited out. That cut tickets mid-stage.

Soft shift close (human directive 2026-10-08) reframes the timeline:

1. **T−15** — seats stop accepting new jobs.
2. **Through shift end and after** — every seat finishes its *current*
   ticket (push forward or bounce back).
3. **Then** — `./finish-shift` (bedtime), not a hard kill at the bell.

## What runs

| When | Script | Effect |
|------|--------|--------|
| Shift end − 15 min (e.g. 16:45 weekday day) | `swarmforge/scripts/shift_close_freeze_intake.sh` | Arms `control-pause.json` (same freeze as Control `/pause` / BL-617): no dequeue from `inbox/new`, no backlog promotion. In-flight parcels keep working. Handoffs land in the sender outbox and wait for delivery after the pause clears. Also pre-consumes today's cooldown window so the 17:00 cooldown does not double-pause. |
| Shift end (e.g. 17:00) | `day-shift-bedtime.sh` → `wait_for_expedite_then_bedtime.sh` | Re-arms freeze if T−15 was missed; waits out expedite; **drains until every live role's `inbox/in_process` is empty** (`wait_in_flight_drain.sh` / `isInFlightEmpty`); then `./finish-shift`. |
| Drain ceiling | `SWARMFORGE_SHIFT_CLOSE_DRAIN_TIMEOUT_MS` (default **4 hours**) | If in-flight work is still present, bedtime proceeds as `forced` rather than waiting forever. |

`inbox/new` may still hold mail when bedtime runs — that is deliberate. Soft
close is not BL-423's full pipeline drain (`isPipelineEmpty`), which also
waits for `new/` to empty.

## Manual drain-stop vs soft close

| | Soft shift close | Control **Drain & stop** |
|--|------------------|---------------------------|
| Freeze new jobs first | Yes (T−15 / pause) | No (unless already paused) |
| Wait for | `in_process` empty | `new/` **and** `in_process` empty |
| Then | `./finish-shift` (phone path up) | Emergency-style full stop path |

## Overrides

- `SWARMFORGE_SHIFT_CLOSE_DRAIN_TIMEOUT_MS` — drain ceiling (ms).
- `SWARMFORGE_SHIFT_CLOSE_DRAIN_POLL_MS` — poll interval (default 15s).
- One-night evening remainder (`evening-shift-tonight.json`) still skips the
  17:00 bedtime path entirely; use that only when the pack should keep
  running past soft close.

## Verification

```sh
# Predicate: new mail alone does not block soft drain
node -e "const d=require('./extension/out/tools/telegramPipelineDrain'); console.log(d.isInFlightEmpty('.'))"

# Shell drain helper (fixture covered by test_wait_in_flight_drain.sh)
bash swarmforge/scripts/test/test_wait_in_flight_drain.sh

# Freeze is armed
cat .swarmforge/operator/control-pause.json
```
