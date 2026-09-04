# The closing ceremony: one sequence, every sleep after work (BL-658, folds in BL-820)

## Why

An independent morning briefing clock (`briefing_morning_time_utc`) can fire
**after** the swarm already stopped — silent miss (2026-07-26). Moving that
constant earlier creates a sibling-clock hazard: change the night window,
forget the constant, the mailman dies again.

BL-658 makes the morning briefing **the last act of closing**, not a second
timer. It always covers the whole night and cannot fire against a stopped
swarm, because it is what precedes the stop.

**BL-1393 (2026-09-04) folded the [BL-820 lean closing-ceremony
packet](../reference/BL-820-closing-ceremony-lean-pass.md) into this same
sequence, and moved when it fires.** Until then these were two mechanisms
with two triggers: the daemon's overnight window ran BL-658's freeze/drain/
briefing/stop without the lean pass, and `./finish-shift` ran the lean pass
alone with no drain, briefing, or email — so an ordinary weekday 17:00
bedtime, the normal way this swarm sleeps, never ran the full ceremony at
all. Per the human's directive ("820 should be part of 658 ... each time the
swarm does at least 1 shift and goes to sleep"), the lean pass is now one
named step inside the one ceremony sequence below, and every sleep path — not
just the daemon's overnight window — drives it. See "One ceremony, every
sleep" below for the trigger and "did at least one shift" logic. The shift
schedule itself (crontab, `continuous-shifts.json`, the weekday/weekend
policy) is untouched by this — BL-1393 changed WHEN the ceremony runs, never
WHICH shifts exist.

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
3. **Lean pass (BL-1393, was BL-820 alone)** — `runClosingCeremony` folds
   the shift's lifecycle ledger into a packet and delivers it to the
   specifier, or (if the shift did nothing) records an explicit
   `no_change`/empty outcome itself. Same recorder either way — a sleep
   after no work is a distinguishable outcome, not silence.
4. **Happy path** — if drain ended at documenter, chain into briefing; else
   rotate resident to documenter with explicit briefing instruction.
5. **Briefing** — written, committed, send confirmed via sent-state (not
   “file exists”). Already-sent nights are not double-sent.
6. **Full stop** — night-stop / hard deadline (e.g. 06:00) remains the
   unconditional backstop if the ceremony hangs.

## One ceremony, every sleep (BL-1393)

`night-closing-ceremony-run.ts` is now driven by every sleep path, not just
the daemon's overnight closure window:

- `./finish-shift` (used directly, by `day-shift-bedtime.sh`, and by
  `wait_for_expedite_then_bedtime.sh`) and `night-stop.sh` now call the CLI
  with `--sleep-path finish-shift` (or the caller's own name) — this says
  "this stop IS a sleep" so the ceremony runs whatever the hour, unlike the
  daemon's own trigger, which stays gated by its overnight closure window.
  `swarmforge/scripts/finish_shift_lib.sh` no longer calls the BL-820 lean
  CLI directly; that call was removed (dead logic, not re-shipped) now that
  the lean pass is a step inside the one sequence.
- A **restart is not a sleep**: `remote_bounce.sh`, a hotfix relaunch via
  `kill_all_swarm.sh`, and an expedite park never invoke the ceremony —
  only the sleep paths above do.
- **"Did at least one shift"** is read from what the swarm already writes,
  never a new bookkeeping file: `shiftWorkedSinceLastCeremony` compares the
  newest mtime of `.swarmforge/shift-started` (explicit, but nothing writes
  it yet — see below) / `.swarmforge/swarm-identity` (rewritten by
  `swarmforge.sh` on every launch, so its mtime IS the shift start) against
  the newest file under `.swarmforge/lean/ceremony/`. **Fails OPEN**: if it
  cannot tell (no stamp readable), it answers `true` — a missing stamp on a
  swarm that worked all day must never silence the ceremony; the empty-
  outcome path is for a shift that demonstrably did nothing, never for a
  failed probe.
  - `.swarmforge/shift-started` is read first when present, but
    `swarmforge.sh` does not write it yet — BL-1328's property test refuses
    an added executable line there unless it sits inside that file's own
    detection helper, a guard that binds on every parcel after the one it
    was pinned to. Recorded as surfaced, not fixed, by this ticket; honoring
    the path costs nothing today and means whoever lifts that guard need
    only add the one line.

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
[BL-820 lean-pass packet shape](../reference/BL-820-closing-ceremony-lean-pass.md)
(the step this sequence now runs, not a separate mechanism since BL-1393).
