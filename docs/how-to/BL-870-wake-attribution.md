# BL-870: Diagnosing a wake with attribution records

**Before this, only a withheld wake left a trace.** `handoffd.bb`'s chase
sweep logged `chase-wake-skip-<reason>` when it decided *not* to wake a role,
but a wake that actually landed injected text into the pane and recorded
nothing about what motivated it. A false "new handoff mail" wake against a
genuinely empty mailbox recurred twice (2026-08-07, 2026-08-10) and was
undiagnosable both times for exactly that reason — the log could show that
dozens of wakes were suppressed and could not show what the ones that got
through were for.

This does not claim to fix the false wake; the cause is still unknown. It
makes the *next* occurrence self-explaining.

## What gets recorded

Every wake the daemon's chase path injects **or** withholds now appends one
JSON line to a durable, monthly log:

```
.swarmforge/telemetry/wake-attribution-<YYYY-MM>.jsonl
```

(sibling to the existing `chaser-telemetry-<YYYY-MM>.jsonl`, kept as its own
file because chaser telemetry only ever records the cases that *did*
something — chase/nudge/respawn — never the skipped half).

Each line:

| Field | Meaning |
|---|---|
| `role` | the role the wake targeted |
| `sweep` | which sweep decided it — `inbox-item`, `stuck-in-process`, or `claim-idle-probe` |
| `handoffId` | filename of the `.handoff` the sweep found sitting in that role's mailbox at attribution time, or `null` |
| `handoffPresent?` | `true`/`false` — explicit, so an absent handoff is a recorded fact, never inferred from a blank field |
| `outcome` | `landed` (wake text was injected) or `skipped` (withheld) |
| `skipReason` | present only when `outcome` is `skipped` — e.g. `busy` |
| `at` / `atMs` | ISO-8601 and epoch-ms timestamp |

The mailbox is read fresh at attribution time (`:new` for the `inbox-item`
sweep, `:in_process` for `stuck-in-process` and `claim-idle-probe`), not
threaded from the sweep's own earlier scan — so an attribution never claims a
handoff the sweep saw a moment ago but that has already moved on, and a
genuinely empty mailbox is caught the same way the original false wake would
be.

## Reading a false-wake report

1. Find the wake's approximate time and pull that month's file:
   ```bash
   grep '"role":"coordinator"' .swarmforge/telemetry/wake-attribution-2026-08.jsonl | tail -20
   ```
2. Check `outcome`: `landed` means text actually reached the pane at that
   timestamp.
3. Check `handoffPresent?`:
   - `false` — the sweep found the mailbox genuinely empty at wake time. This
     is the fingerprint of the original defect: a wake fired with nothing
     behind it.
   - `true` — a real `handoffId` motivated the wake; if the pane still reads
     as having "nothing to do," look at what happened to that handoff after
     the wake (moved to `completed/`, abandoned, etc.), not at the wake
     itself.
4. `sweep` tells you which code path to inspect next — `inbox-item` and
   `stuck-in-process` both run through `chase-poke-and-notify!`;
   `claim-idle-probe` is the separate claim-without-progress injector.

## What this does not do

- It does not change which wakes happen. Recording a wake attribution is
  strictly observational — the sweep's wake/skip/rotate decision is identical
  whether or not the record succeeds (invariant, covered by scenario
  wake-attribution-05).
- `:rotate` outcomes (the daemon respawning a pane rather than injecting text
  into an existing one) are not attributed here — there is no wake text for
  this ticket's invariant to cover.
- A recording failure never blocks the wake it describes — the write is
  wrapped in try/catch and logs `wake-attribution-error` on failure rather
  than throwing.

## Verify

```bash
bb swarmforge/scripts/test/wake_attribution_lib_test_runner.bb
bb swarmforge/scripts/test/bl870_wake_attribution_property_runner.bb
bash swarmforge/scripts/test/test_handoffd_wake_attribution_wiring.sh
```

The first two cover the pure record builder and mailbox scan in isolation;
the third drives the real `handoffd.bb` chase sweep against fixture roles and
reads the JSONL back, proving the wiring behaviourally rather than by
grepping the daemon source for a call site.

Acceptance feature: `specs/features/BL-870-wake-attribution.feature`.
