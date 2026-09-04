# INTAKE — shift_schedule_applier_lib.bb crashes on `process/shell`, and something stripped 3 of 4 cron lines overnight

**Source:** human via Claude Code, 2026-09-04  
**Status:** new intake, not minted  
**Priority:** high — the schedule cron install path is a real correctness
surface (it can rewrite the user's crontab), and it is currently broken in
a way that happened to fail safe tonight but should not be trusted to keep
doing so.

## What was observed

Overnight (between ~01:49 BST and 08:19 BST, 2026-09-04), the live crontab
lost 3 of its 4 shift-schedule lines — everything referencing
`.swarmforge/operator/*.sh` (`day-shift-start.sh`, `day-shift-bedtime.sh`,
`night-start.sh`) — while a 4th line referencing `swarmforge/scripts/`
(`wait_for_expedite_then_bedtime.sh`, the weekend-stop entry) and two
unrelated lines (BL-675 freshness check, descent-review) survived
untouched. That split matches exactly what
`reconcile_shift_schedule_crontab.bb`'s `strip-schedule-lines` matches on
(`.swarmforge/operator/` substring, among others) — strong circumstantial
evidence this code path is involved, even though a live repro (below)
shows it currently fails a different way.

Restored by hand tonight: `crontab
.swarmforge/operator/crontab.weekday-day-weekend-night` (the saved
preset). Today's 9am weekday start was ~40 minutes away when this was
caught.

## What's separately, definitely broken

`swarmforge/scripts/shift_schedule_applier_lib.bb:77` calls
`process/shell` after a **local** `(require '[babashka.process :as
process])` inside a `try` (line 76) — babashka/SCI's analysis phase
apparently cannot resolve `process/shell` from a require that only
happens at runtime inside a function body, so every call into this file
crashes:

```
Unable to resolve symbol: process/shell
:phase "analysis"
```

Reproduced live tonight via `bash
swarmforge/scripts/install_shift_schedule_cron.sh <root>` — crashes with
the trace above, `EXIT=1`.

## Why this crash is NOT (by itself) an explanation for the stripped lines

`install_shift_schedule_cron.sh` captures the bb call's stdout via
`result="$(bb ...)"`. On this crash, `result` is empty; the following
`python3 -c "json.load(...)"` step then throws `JSONDecodeError`. That
python step runs inside `read -r ... < <(python3 ...)` — a process
substitution, whose failure `set -e` does not observe in bash — so the
script continues with `scheduling`/`changed`/`mode` all empty, which
`[[ "$scheduling" != "True" && "$scheduling" != "true" ]]` treats as "no
schedule configured", printing that and exiting 0 **before ever reaching
the `crontab -` write**. Verified live tonight: ran the install script for
real with the current (correct, 4-line) crontab in place — it crashed
exactly as above, and the crontab came out byte-identical, all 4 lines
intact.

So: this exact crash is currently harmless to the crontab. Whatever
stripped the 3 lines overnight either hit this code path in a **different,
non-crashing state** (plausible — the live swarm was actively committing
to `swarmforge/scripts/*.bb` files all night, including near this exact
area, so `shift_schedule_applier_lib.bb` may have passed through a
different shape before landing in today's broken one), or the real cause
is a mechanism this investigation did not find. Left genuinely open — do
not assume the process/shell crash is the root cause of the stripping
just because it is the most suspicious thing found; it demonstrably isn't,
as coded right now.

## What's needed

1. Fix `process/shell` — move `(require '[babashka.process :as process])`
   (or the whole namespace require) to the file's top-level `ns`/require
   form instead of inside the function body, so this code path actually
   runs instead of silently no-op'ing via the `set -e`/process-substitution
   gap above.
2. Once it actually runs, re-examine whether it — or some other path
   through `install_shift_schedule_cron.sh` /
   `reconcile_shift_schedule_crontab.bb` — really can strip
   `.swarmforge/operator/`-referencing lines while leaving others, and
   under what live conditions (this human's custom
   `crontab.weekday-day-weekend-night` preset is hand-installed, outside
   the `swarm_shift`/legacy `continuous-shifts.json` modes this reconcile
   code actually recognizes — worth checking whether ANY future
   auto-install path should be touching a hand-installed custom schedule
   at all, versus only ever managing its own recognized modes).
3. The `set -e`-blind-to-process-substitution-failure gap in
   `install_shift_schedule_cron.sh` itself is arguably a second, smaller
   defect worth a look independent of (1) — a crash three layers down
   degrading all the way to "silently do nothing, report success" is the
   kind of silent-good-outcome-from-a-real-failure this project's own
   engineering rules usually flag hard.

## Out of scope

- Re-deriving the exact overnight timeline commit-by-commit — the live
  swarm's own commit history for `swarmforge/scripts/shift_schedule*.bb`
  overnight is the actual evidence trail for that, not re-litigated here.
- The custom weekday/weekend schedule itself (already working, restored,
  not the subject of this intake).
