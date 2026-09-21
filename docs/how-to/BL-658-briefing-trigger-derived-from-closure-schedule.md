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

**A sleep runs the sequence to its own end before the stack stops
(BL-1640).** Before this, the CLI above was ONE tick of the state
machine: the daemon's periodic sweep drove the rest on its overnight
window, but a bedtime kills the daemon seconds after the CLI call, so a
weekday 17:00 sleep got only `freeze-promotion` and nothing after it — no
lean packet, no documenter instruction, no briefing runway (2026-09-18
16:00Z: freeze, then `kill_all_swarm` four seconds later). Two changes
close this:

- **Sleep-relative deadlines.** When `--sleep-path` is set,
  `resolveCeremonyDeadlines` in `night-closing-ceremony-run.ts` computes
  `drainBudgetMs` and `hardDeadlineMs` from **now**, not from today's
  `closure_stop_local`: `drainBudgetMs = closing_drain_budget_minutes *
  60_000`, `hardDeadlineMs = nowMs + drainBudgetMs +
  closing_briefing_budget_minutes * 60_000`. The daemon's own overnight
  trigger (`--sleep-path` unset) is untouched and still anchors
  `hardDeadlineMs` to `closure_stop_local` via `parseHmToMs`. A
  *continuing* sleep (already `frozen`/`draining`/`briefing`) keeps the
  deadlines its first tick wrote — only a NEW ceremony computes fresh
  ones.
- **The loop and its ceiling.** `finish_shift_run_closing_ceremony` in
  `swarmforge/scripts/finish_shift_lib.sh` calls the same CLI, unchanged,
  in a loop (`FINISH_SHIFT_CEREMONY_TICK_SECONDS`, default 30s, 0 in
  tests) until `sleepLoopDecision` (`nightClosingCeremonyLive.ts`) reads
  the state's `phase` as `done`. Past the ceiling —
  `hardDeadlineMs + SLEEP_CEILING_GRACE_MS` (a fixed one-minute grace) —
  it prints `finish-shift: closing ceremony overran its budgets -
  stopping anyway` to stderr and the stack stops regardless: bedtime
  never hangs on a ceremony that never finishes. A tick that exits
  non-zero, or whose state carries no `hardDeadlineMs` at all (an
  unreadable tick, or the gate bypass — unreachable with `--sleep-path`
  set), also stops the loop and lets bedtime continue rather than looping
  forever on a read failure.
- **A second sleep the same calendar day is a new ceremony when a shift
  happened since the first.** `advanceNightClosingCeremony`'s
  `advanceSameDayDone` starts a fresh `startFrozen` ceremony whenever the
  observation is `fromSleep` and `workedAShift !== false`; a second sleep
  with no shift of work since (`workedAShift === false`) leaves the prior
  `done` state exactly as read — still one recorded outcome per day of
  actual work, not silence on the days that do more than one shift.
  `fromSleep` distinguishes this from the daemon's own periodic sweep,
  which must never reopen a night it already closed on its own overnight
  window.

  Live proof: the next weekday bedtime's `day-shift.log` block shows the
  ceremony state `done` with a sequence longer than
  `["freeze-promotion"]`, the specifier's inbox holds that shift's lean
  packet note, and the documenter's inbox holds `produce the morning
  briefing for <date>` — one bedtime, not twenty.

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

## Landing the briefing on main (BL-1459)

The documenter authors and commits `docs/briefings/<date>.md` on its own
branch (human ruling A, 2026-09-07), then sends QA a `note` `land
documenter briefing <10-hex>` (BL-1444's shape, priority `50`) — a
briefing is not a parcel, so it never rides the ordinary `git_handoff`/
merge-up path. Before this ticket that land had no guarded path at all:
2026-09-05's briefing was cherry-picked onto main by hand, 2026-09-06's
was committed on main directly, and 2026-09-07's rode a ticket-less
`git_handoff` through the whole pipeline as a no-op.

`swarmforge/scripts/check_documenter_briefing_tip.sh`, wired into the
shared `pre-merge-commit` hook chain beside `check_art_director_tip.sh`
(BL-1444), now judges QA's `git merge --no-ff <sha>` of that note. Its
predicate has two parts, both settled after two rebuild rounds
(2026-09-20):

1. **Which commit is judged.** The incoming commit must be on the
   documenter branch's own **first-parent** line since the landed main
   (`git rev-list --first-parent`) — neither plain ancestry (too wide: the
   documenter is the pipeline's last stage, so its branch reaches every
   upstream role's commits behind a second parent of an ordinary "Merge X
   into documenter", and those are never a briefing land) nor exact-tip
   equality (too narrow: it silently stops judging the moment the branch
   advances one commit past the tip a landing note named).
2. **Whether it's a briefing at all.** Only a judged commit whose OWN
   delivered content touches `docs/briefings/` is treated as a briefing
   land; everything else exits 0 without judging. Without this content
   trigger the guard enforced itself on the very merge that delivers it
   (`core.hooksPath` runs `pre-merge-commit` from the MERGED tree) and
   refused every ordinary documenter parcel forward to QA — CRITICAL,
   caught 2026-09-20.

A judged briefing commit's own changed paths must be exactly one day's
`docs/briefings/<date>.md` and, optionally, the same date's `.json`
sidecar — never `docs/briefings/.sent.json` (the email sweep's own
sent-state) and never a second `docs/briefings/<date>.md` for a date the
landed main already carries. A path whose last touching commit is already
reachable from the landed main is exempt (BL-1096 provenance, same as the
art-director guard). `check_documenter_briefing_tip.sh --tip <sha>` prints
`DOCUMENTER_BRIEFING_TIP_OK` or `DOCUMENTER_BRIEFING_TIP_REFUSED <reason>`
for direct use outside a merge. The documenter branch is read from
`.swarmforge/roles.tsv` (pack-dependent — `swarmforge-documenter` here,
`primary/documenter` on the nested pack), never hard-coded — the same
roster-resolution shape `check_art_director_tip.sh` gained afterward
(BL-1657, `docs/how-to/BL-1418-the-art-director-seat-is-addressable.md`),
once its own hard-coded `primary/art-director` literal was found to
refuse every live tip on this host since 2026-09-06.

A bounced parcel that changes a hook in this shared chain must be
reverted off the bouncing branch in the bounce step itself (not just
fixed forward) — the chain runs from the merged tree on every downstream
merge, so a bounced guard left in place keeps enforcing a stale rule
against every later merge of that branch, documenter or not.

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
