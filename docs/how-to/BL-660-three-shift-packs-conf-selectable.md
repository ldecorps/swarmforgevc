# Three named shift packs — one active shift in conf (BL-660)

*How-to. Task-oriented: run the swarm on a named 8-hour shift and keep every
schedule-derived clock aligned.*

The operator requested three shifts ("les 3 huits") with exactly one active at
a time:

| Shift | Local hours | Pause outside (cooldown inverse) |
| --- | --- | --- |
| `day` | 09:00 – 17:00 | 17:00 – 09:00 |
| `evening` | 17:00 – 01:00 (spans midnight) | 01:00 – 17:00 |
| `night` | 01:00 – 09:00 | 09:00 – 01:00 |

Set in `swarmforge/swarmforge.conf`:

```text
config swarm_shift night
```

Valid values: `day`, `evening`, `night`. **Absent or blank** → 24/7 semantics
byte-identical to today's disabled cooldown window — no shift-derived crontab
lines, independent `cooldown_*` keys behave as before.

## The one rule

When `swarm_shift` is active, it is the **only** schedule source. These derive
from it automatically — do not hand-edit parallel constants:

1. **Start/stop crontab** — rendered by `apply_shift_schedule.bb` (idempotent,
   diffs before write; human-edited lines the applier did not render are
   **surfaced**, never clobbered).
2. **BL-617 cooldown window** — pause outside working hours (inverse of the
   shift). `cooldown_window_enabled` and `cooldown_start_local` /
   `cooldown_end_local` are derived when a shift is active.
3. **BL-658 closing ceremony** — `closure_stop_local` **is** the shift end.
4. **Briefing** — via ceremony (last act) or shift-end minus margin until
   BL-658 owns the path on your branch.

Pure resolution lives in `swarm_shift_lib.bb` (Babashka) and
`extension/src/tools/swarmShiftCore.ts` (TypeScript) — both must agree.

## Apply shift schedule to crontab

From the project root (fixture or live host):

```bash
bb swarmforge/scripts/apply_shift_schedule.bb <project-root>
```

Dry-run and custom crontab path:

```bash
bb swarmforge/scripts/apply_shift_schedule.bb <project-root> --dry-run
bb swarmforge/scripts/apply_shift_schedule.bb <project-root> --crontab-file /path/to/crontab
```

Managed lines sit between `# swarmforge-shift-schedule-begin` and
`# swarmforge-shift-schedule-end`. Re-running with unchanged conf is a no-op.

## Operator workflows

### Switch shift while stopped

Edit `config swarm_shift` in conf, then run the applier. The next scheduled
cycle uses the new shift only — stale start/stop lines from the old shift must
not remain armed.

### Switch shift while running

Takes effect at the **next boundary** only. The current shift continues until
its scheduled stop; never kills a working swarm mid-shift.

### Manual start outside the shift

Legal and unmanaged — e.g. midday backlog drain. Shift machinery must not pause,
kill, or immediately re-schedule the swarm. The next scheduled boundary applies
normally afterward (consume the cooldown marker by hand today becomes part of
this path).

### Provider outage credit (effective 8h)

Signature-backed provider outages (BL-650 rule) may **extend** the shift close
so the shift aims at eight **effective** hours, not eight wall hours:

- Capped (default 2h) and never crosses the next shift boundary minus safety
  margin.
- Swarm-caused downtime (crashes, restarts) **never** credits.
- Extended close is announced to the Operator topic — never silent overtime.

TypeScript helper: `effectiveCloseLocal()` in `swarmShiftCore.ts`.

## Telegram offline approvals

With any single shift active, the longest stopped gap between consecutive runs
stays **under 24 hours** (Telegram `getUpdates` retention). All three 8-hour
shifts leave a 16-hour gap — pinned in acceptance so future compositions cannot
silently break it.

## Verify

```bash
bb swarmforge/scripts/test/swarm_shift_lib_test_runner.bb
bash swarmforge/scripts/test/test_shift_schedule_applier.sh
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-660-three-shift-packs-conf-selectable.feature
```

## Siblings

- [Nightly cooldown window](BL-617-nightly-cooldown-window.md) — pause machinery BL-660 derives when a shift is active
- [Cold-swap day shift Ollama pack](BL-1143-cold-swap-day-shift-ollama-qwen.md) — pack selection separate from shift schedule
