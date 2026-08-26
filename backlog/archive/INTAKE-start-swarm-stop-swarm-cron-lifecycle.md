# INTAKE — start-swarm installs swarm crons; stop-swarm disables them all

**Source:** human via Cursor, 2026-08-26  
**Severity:** high (operational incident — repeated on Mac host two days running)  
**Status:** new intake, not minted. Specifier: mint and spec (defect / reliability).

## Operator directive (locked)

> start-swarm should ensure necessary cron jobs are in place.  
> Conversely, and that's very important, stop-swarm should ensure they are
> disabled.

**Incident:** For the second day in a row, the swarm was started on the Mac
host while cron jobs were still active, causing all sorts of problems — schedule
wake/stop scripts and/or the freshness watchdog fighting a deliberate manual
start/stop.

## Why this is in front of you

Swarm lifecycle is supposed to be **symmetric** at the `./start-swarm.sh` /
`./stop-swarm.sh` boundary. Today it is **partial**:

| Cron class | Examples | Installed on start? | Removed on stop? |
|------------|----------|---------------------|------------------|
| Daemon freshness watchdog (BL-675/783) | `swarmforge-BL-675-freshness-check` marker | Yes — `start_ancillary_services.sh` → `install_freshness_cron.sh` | Yes — `stop-swarm.sh` → `uninstall_freshness_cron.sh` (BL-785) |
| Scheduled shift start/stop | `night-start.sh`, `night-stop.sh`, `day-shift-start.sh`, `day-shift-bedtime.sh` | **No** — hand-maintained under `.swarmforge/operator/crontab.*`, applied outside start/stop | **No** |
| Future conf-rendered shift crons (BL-660) | Applier-rendered start/stop from active `swarm_shift` | Not wired yet | Not wired yet |

So a human can `./stop-swarm.sh` and believe the host is quiet, but **schedule
crons keep firing** — `night-start.sh` calls `./start-swarm.sh` again,
`day-shift-bedtime.sh` / `night-stop.sh` call stop paths that may not match
what the human just did, and on Mac the stale lines may still point at paths or
behaviour from a prior host layout. Conversely, `./start-swarm.sh` installs the
freshness line but **does not reconcile** whether the operator's chosen shift
schedule is actually present in the live crontab.

BL-785 closed the **freshness resurrection** hole only. It did **not** close
the **schedule cron still armed after stop** hole that bit the operator twice.

## Goal

1. **`./start-swarm.sh` (full stack)** — after a successful bring-up, the host's
   user crontab contains every cron line this root **needs while the swarm is
   meant to be running**, and no stale swarmforge lines for *other* roots on
   the same host are disturbed (BL-783 root-scoped marker pattern).
2. **`./stop-swarm.sh` (full stack)** — after a successful teardown, **all**
   swarmforge-managed cron lines for this root are **gone or explicitly
   disabled** so nothing can wake, stop, or resurrect the stack until the
   human starts again. This is the critical half — a stop must mean *stop*.
3. **Idempotent and root-scoped** — safe to re-run; multi-root hosts keep
   sibling roots' lines intact.
4. **Observable** — start/stop logs name what was installed/removed; a human
   can `crontab -l` and see the expected state without reading source.

## Known cron inventory (specifier must confirm completeness)

Scripts under `.swarmforge/operator/` today:

- `night-start.sh` / `night-stop.sh` — unattended start/stop (historical 3-shift
  night window; superseded in intent by BL-660 but still live on some hosts)
- `day-shift-start.sh` / `day-shift-bedtime.sh` — day-only pack (human ruling
  2026-08-24; see `crontab.day-only`)
- Freshness checker — `swarmforge/scripts/daemon_log_freshness_check.sh` via
  `install_freshness_cron.sh`

Reference crontab snapshots (not authoritative — live crontab is truth):

- `.swarmforge/operator/crontab.day-only`
- `.swarmforge/operator/crontab.night-standing`

Any line referencing `$ROOT`, `.swarmforge/operator/*-start.sh`,
`*-stop.sh`, `*-bedtime.sh`, or the BL-675 freshness marker for this root
counts as **in scope**.

## Preferred shape (specifier may refine)

- **Single registry** — one place (script or conf) lists all swarmforge cron
  line kinds for a root; install/uninstall helpers share marker conventions
  (extend BL-783's root-scoped bracket marker pattern).
- **Start path** — after ancillaries succeed, ensure required lines (at minimum
  freshness; plus active shift schedule when BL-660 / operator conf says
  scheduling is on). Respect `SWARMFORGE_SKIP_*` skips already used for
  freshness.
- **Stop path** — **before or after** process teardown (specifier picks — stop
  must win even if teardown fails partway): remove/disable **every** registered
  line for this root, not only freshness. BL-785 tests become one case in a
  broader battery.
- **BL-660 alignment** — if shift crons are conf-rendered, start/stop become
  thin wrappers around the applier's ensure/remove modes rather than a third
  hand-maintained crontab path. Until BL-660 lands, still remove/install the
  operator's currently configured schedule lines so Mac/WSL handoffs do not
  leave ghosts.
- **Mac host** — cron `PATH` baking (BL-789/796) applies to every installed
  line, not only freshness.

## Acceptance signals (Gherkin-ready)

```gherkin
Scenario: stop-swarm leaves no swarmforge crons for this root
  Given the user crontab has freshness and schedule start/stop lines for root R
  And the swarm is up
  When the operator runs ./stop-swarm.sh R
  Then crontab -l contains no line with marker or path scoped to R's swarmforge crons
  And no scheduled script under R/.swarmforge/operator can fire for R

Scenario: start-swarm ensures required crons for this root
  Given the user crontab has no swarmforge lines for root R
  And operator conf selects a shift schedule (or 24/7 freshness-only)
  When the operator runs ./start-swarm.sh R
  Then crontab -l contains the freshness line for R
  And when shift scheduling is active, crontab -l contains the rendered start/stop lines for R

Scenario: deliberate stop survives the next cron tick
  Given ./stop-swarm.sh R completed successfully
  When two minutes elapse (freshness interval)
  And the next schedule boundary passes if any schedule line remained
  Then handoffd and babysitterd for R are still down
  And nothing has invoked start-swarm.sh for R

Scenario: multi-root host isolation
  Given crontab lines for roots R1 and R2
  When ./stop-swarm.sh R1
  Then R2's swarmforge lines are unchanged
```

## Out of scope

- Rewriting BL-660 shift-pack semantics (coordinate, do not duplicate).
- Changing what `night-start.sh` / `day-shift-start.sh` do internally beyond
  cron install/remove wiring.
- Disabling **non-swarmforge** user crons on the host.

## Related tickets / docs

- **BL-785** (done) — freshness cron removed on stop; partial fix.
- **BL-783** (done) — freshness cron installed on start via ancillaries.
- **BL-675** — freshness watchdog mechanism.
- **BL-660** (active) — conf-rendered shift crons; long-term single source.
- **BL-658** (done) — closure schedule derived from crontab; stop path must
  stay consistent.
- **BL-653** — night-start pid-hold; schedule start behaviour.
- Tests: `test_stop_swarm_freshness_cron.sh`, `test_start_ancillary_services_freshness_cron.sh`
- Operator snapshots: `.swarmforge/operator/crontab.day-only`,
  `crontab.night-standing`

## Mint hint

Type: **defect** (symmetry / durability of stop). Epic: swarm-reliability.
Priority: high — blocks trustworthy manual operation on Mac and any host where
schedule crons were ever applied. Consider expedite if specifier agrees the
two-day repeat qualifies.
