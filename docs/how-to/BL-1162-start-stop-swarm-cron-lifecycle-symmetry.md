# Symmetric swarmforge cron install on start and remove on stop (BL-1162)

*How-to. Task-oriented: keep user crontab lines for this swarm root aligned with
whether the stack is deliberately running.*

Human directive (verbatim):

> start-swarm should ensure necessary cron jobs are in place. Conversely, and
> that's very important, stop-swarm should ensure they are disabled.

BL-785 closed the freshness-only half: `./stop-swarm.sh` removed the BL-675
freshness line but left operator schedule start/stop/bedtime lines armed. After
a deliberate stop, `night-start.sh`, `day-shift-bedtime.sh`, or the freshness
watchdog could still wake or fight the operator. BL-1162 makes start and stop
symmetric for **every** swarmforge line scoped to this project root.

## What gets managed

One shared registry (`swarmforge/scripts/swarmforge_cron_lib.sh`) decides
whether a crontab line belongs to root `R`:

| Kind | Marker / path pattern |
| --- | --- |
| Freshness watchdog | `# swarmforge-BL-675-freshness-check root=[R]` |
| Legacy operator schedule | `# swarmforge-operator-schedule root=[R]` |
| BL-660 shift schedule block | `# swarmforge-shift-schedule-begin R` … `end` |
| Operator scripts | paths under `R/.swarmforge/operator/` |
| Lifecycle wrappers | `R/start-swarm.sh`, `R/stop-swarm.sh` |

Multi-root hosts are isolated: removing lines for `R1` never touches `R2`.

## Start path — ensure required lines

After ancillaries succeed, `start_ancillary_services.sh` calls:

```bash
bash swarmforge/scripts/install_swarmforge_crons.sh <project-root>
```

That helper installs, in order:

1. **Freshness** — `install_freshness_cron.sh` (BL-675/783), unless
   `SWARMFORGE_SKIP_FRESHNESS_CRON=1`.
2. **Shift schedule** — `install_shift_schedule_cron.sh`, which reconciles via
   `reconcile_shift_schedule_crontab.bb` from legacy
   `continuous-shifts.json`, operator schedule scripts, and active
   `config swarm_shift day|evening|night` (BL-660), unless
   `SWARMFORGE_SKIP_SCHEDULE_CRON=1`.

When no shift is configured, schedule install is a no-op (24/7 semantics
unchanged). Logs name what was installed or skipped.

**Silent failure window, fixed 2026-09-04 (BL-1381):** a broken
`babashka.process` require inside `shift_schedule_applier_lib.bb` crashed
the whole file at load — not just the code path it sat in — on every
`./swarm start` since 2026-08-27. `install_shift_schedule_cron.sh`'s
wrapper caught the crash (`set -euo pipefail`) and printed only `WARN:
swarmforge cron install failed` into launch output, which nobody reads; a
configured `swarm_shift` schedule never actually installed for those eight
days. A second, smaller gap let a reconcile that exited 0 with unparseable
output be reported as "no schedule configured" (a real failure read as a
legitimate outcome) — both are fixed by the same rule: the wrapper now
exits non-zero and names the cause on any outcome other than its three
legitimate ones (no schedule configured, already current, installed), and
never touches crontab on a failed or verdict-less reconcile.

Manual repair (stack already up):

```bash
bash swarmforge/scripts/install_swarmforge_crons.sh /path/to/project-root
```

## Stop path — remove every registered line

After a **successful** full-stack stop (no surviving supervised processes, pipeline
stop exit 0), `./stop-swarm.sh` calls:

```bash
bash swarmforge/scripts/uninstall_swarmforge_crons.sh <project-root>
```

That filters the live user crontab through `swarmforge_cron_filter_out_root` and
rewrites it. A WARN is printed if uninstall fails; the operator should re-run the
command above.

**Ordering choice (documented):** cron removal runs only after the stop is
declared successful. A REFUSE (survivors left, or pipeline stop non-zero) leaves
cron lines armed so schedule/freshness behaviour matches the still-partially-live
stack — fix the stop first, then uninstall manually if needed.

Pipeline-only stop (`./swarm-kill` / `kill_pipeline_swarm.sh`) does **not** call
the full cron uninstall — babysitterd and schedule machinery may still be
intentionally up.

## Verify state

```bash
crontab -l | grep -F '/path/to/project-root' || echo 'no lines for this root'
```

After `./stop-swarm.sh`: expect **no** matching lines.

After `./start-swarm.sh` with scheduling configured: expect freshness
plus rendered start/stop schedule lines (legacy operator schedule and/or
BL-660 `swarm_shift` conf via `reconcile_shift_schedule_crontab.bb` —
see [BL-660 three shift packs](BL-660-three-shift-packs-conf-selectable.md)).

## Related docs

- [Daemon log freshness watchdog](BL-675-daemon-log-freshness-watchdog.md) —
  freshness marker semantics (BL-785 deliberate-stop path).
- [Three named shift packs](BL-660-three-shift-packs-conf-selectable.md) —
  `swarm_shift` conf as the sole schedule source (installed by BL-1162 start path).
- [Bedtime vs lights-out](BL-762-finish-shift-bedtime-vs-lights-out.md) —
  `./finish-shift` vs `./stop-swarm.sh` scope (bedtime does not uninstall crons).
