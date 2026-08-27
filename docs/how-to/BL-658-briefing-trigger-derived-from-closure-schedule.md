# Night closing ceremony: briefing is the last act before stop (BL-658)

## Why

An independent morning briefing clock (`briefing_morning_time_utc`) can fire
**after** the swarm already stopped — silent miss (2026-07-26). Moving that
constant earlier creates a sibling-clock hazard: change the night window,
forget the constant, the mailman dies again.

BL-658 makes the morning briefing **the last act of closing**, not a second
timer. It always covers the whole night and cannot fire against a stopped
swarm, because it is what precedes the stop.

This is **not** the [BL-820 lean closing-ceremony packet](../reference/BL-820-closing-ceremony-lean-pass.md)
(process outcome for the specifier). BL-658 is the **night-stop / briefing
orchestration** path inside `handoffd`.

## Config (single source)

| Key | Role |
| --- | --- |
| `closure_stop_local` | Authoritative local wall-clock stop (e.g. `06:00`) |
| `closing_drain_budget_minutes` | In-flight parcel drain budget (default 25) |
| `closing_briefing_budget_minutes` | Briefing production budget (default 10) |
| `briefing_morning_time_utc` | Fixed-time fallback for 24/7 swarms with **no** usable closure schedule |

Ceremony begin = `closure_stop_local` − (drain + briefing budgets). Moving the
stop time moves the ceremony — no second clock to edit.

## Sequence

1. **Freeze promotion** — no new parcel delivery; queues hold.
2. **Drain** in-flight parcel within budget; overrun → park claim intact +
   loud `closing-drain-deadline-exceeded` (BL-648 owns morning resume).
3. **Happy path** — if drain ended at documenter, chain into briefing; else
   rotate resident to documenter with explicit briefing instruction.
4. **Briefing** — written, committed, send confirmed via sent-state (not
   “file exists”). Already-sent nights are not double-sent.
5. **Full stop** — night-stop / hard deadline (e.g. 06:00) remains the
   unconditional backstop if the ceremony hangs.

## `handoffd` wiring

Before the fixed morning generation sweep:

1. Shell `night-closing-ceremony-gate.js` (pure schedule decision).
2. When `mode: ceremony` and `ceremonyDue`, run
   `night-closing-ceremony-run.js` and **do not** consult the independent
   morning trigger.
3. When schedule is `absent` / `ambiguous`, keep today's
   `briefing_morning_time_utc` path (byte-identical for 24/7 packs).

Pure decision logic: `extension/src/quality/nightClosingCeremony.ts` (+ live
advance / gate / run CLIs under `extension/src/tools/`).

## Operator notes

- Edit **`closure_stop_local`** (and budgets) in `swarmforge.conf` — not a
  hand-edited sibling briefing constant on the closure-scheduled path.
- Host crontab generation from conf may land as a sibling slice; conf remains
  authoritative.
- Forbidden outcome remains silence: missing briefing /
  drain-deadline surfaces must be loud.

## Acceptance

`specs/features/BL-658-briefing-trigger-derived-from-closure-schedule.feature`

Related: [BL-258 headless morning trigger](../reference/Specification.MD)
(fixed-time path retained for no-schedule swarms), [BL-762 bedtime vs
lights-out](BL-762-finish-shift-bedtime-vs-lights-out.md),
[BL-820 lean ceremony](../reference/BL-820-closing-ceremony-lean-pass.md).
