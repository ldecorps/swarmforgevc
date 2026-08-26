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
   `continuous-shifts.json` / operator schedule scripts only — **BL-660
   `swarm_shift` conf rendering is out of scope until that ticket lands**,
   unless `SWARMFORGE_SKIP_SCHEDULE_CRON=1`.

When no shift is configured, schedule install is a no-op (24/7 semantics
unchanged). Logs name what was installed or skipped.

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

After `./start-swarm.sh` with legacy scheduling configured: expect freshness
plus rendered start/stop schedule lines. When BL-660 lands,
`reconcile_shift_schedule_crontab.bb` will also render `swarm_shift` conf —
see [BL-660 three shift packs](BL-660-three-shift-packs-conf-selectable.md).

## Related docs

- [Daemon log freshness watchdog](BL-675-daemon-log-freshness-watchdog.md) —
  freshness marker semantics (BL-785 deliberate-stop path).
- [Three named shift packs](BL-660-three-shift-packs-conf-selectable.md) —
  future `swarm_shift` rendering (coordinates with BL-1162 when BL-660 lands).
- [Bedtime vs lights-out](BL-762-finish-shift-bedtime-vs-lights-out.md) —
  `./finish-shift` vs `./stop-swarm.sh` scope (bedtime does not uninstall crons).
