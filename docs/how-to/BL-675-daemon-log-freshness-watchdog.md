# BL-675: Daemon log-freshness watchdog

**Process liveness lies.** A futex-wedged or mute-loop daemon can keep its pid
alive while its log freezes — and every in-process watcher shares that fate.
This watchdog is the share-no-fate pulse: a cron-scheduled POSIX script that
restarts wedged sweep daemons from outside bb/node/the swarm.

## What it watches

| Daemon | Log | Threshold | Start script |
|---|---|---|---|
| handoffd | `.swarmforge/daemon/handoffd.log` | 120s | `start_handoff_daemon.sh` |
| babysitterd | `.swarmforge/babysitterd/babysitterd.log` | 600s | `start_babysitterd.sh` |

(BL-611 ported babysitterd into the tracked repo and moved its state from
`.swarmforge/babysitter/` to `.swarmforge/babysitterd/` — see
[the babysitterd runbook](BL-611-babysitterd-runbook.md).)

Thresholds and paths live in one place:
`swarmforge/scripts/daemon_log_freshness.conf`. These are **base**
thresholds — see "Contention-relative threshold" below for how the
*effective* threshold the checker actually applies can exceed them on a
loaded host.

Both daemons emit a timestamped, content-free `heartbeat` line on every loop
tick, so a healthy quiet period (cooldown pause, no work) never looks dead.
`handoffd` writes it **twice per cycle — at the start AND the end** (BL-789):
observed Mac cycles run 140-232s, close to/past the 120s threshold, so a
start-of-cycle pulse is what keeps a merely-slow cycle from looking
identical to a wedged one until the whole cycle finishes.

## Contention-relative threshold (BL-1012)

A fixed threshold encodes an assumption about host contention that nothing
recorded and nothing rechecked. On 2026-08-21 the Mac sat at load average 80
on four cores (contention factor 20) — a single handoffd chase sweep took
17.2s, and the watchdog killed and restarted a daemon that was late, not
hung, nine times in a day (694 rotated `handoffd.log.*` archives by 11:11).

The checker now scales each daemon's base threshold by the host's
**contention factor** — `load average / core count`, integer division,
floored at 1 — before comparing it to the heartbeat age:

```
effective_threshold = min(base_threshold * contention_factor, 600)
```

- **At factor 1** (idle/nominal host) the effective threshold equals the
  base threshold exactly — a genuinely hung daemon still reds in two
  minutes on a quiet box. This does not raise the threshold; it stops a busy
  host from being held to a number that was only ever true at 1x.
- **The ceiling is 600 seconds** — the bound `babysitterd` already carries
  in this same conf — so a dead daemon is always caught within 10 minutes,
  however loaded the box gets.
- Load average and core count are read from the host (`/proc/loadavg` /
  `sysctl -n vm.loadavg` on macOS; `nproc` / `sysctl -n hw.ncpu`) and can be
  pinned deterministically via `FRESHNESS_LOAD` / `FRESHNESS_CORES` (see
  "Manual / test seams" below). Unreadable or unparseable input falls back
  to factor 1.

## Grace window after a self-performed restart (BL-1012)

`start_handoff_daemon.sh` moves `handoffd.log` aside (`mv ... .log.<stamp>`)
on every start, and the checker restarts through that same script. So
immediately after a restart the checker itself performed, the log the next
check reads is one that restart just rotated away, and `heartbeat_age_secs`
returns its file-absent sentinel — alarming on that is alarming on the
watchdog's own footprint, and if the restart failed to bring the daemon back
up, it would repeat every two minutes forever with nothing left to diagnose
from.

For `FRESHNESS_RESTART_GRACE` seconds (default 300) after a restart the
checker performed, an absent or heartbeat-less log is **not** a violation —
it is recorded as `action=grace` and nothing is killed, restarted, or
announced. This is scoped to the file-absent sentinel only: a daemon that
came back up and then went stale again inside the grace window is a genuine
violation and still fires normally.

## Install

**Automatic (BL-783).** `start_ancillary_services.sh` — the lifecycle start
path every `./swarm` launch runs — calls `install_freshness_cron.sh` for you
after babysitterd starts. There is no operator step: the cron is present on
any host where the swarm has ever been started. Set
`SWARMFORGE_SKIP_FRESHNESS_CRON=1` to opt out. A host with no `crontab`
command, or a read-only crontab, does not fail the swarm start — it prints a
`WARN:` line naming what will not be watched and carries on.

**Manual (repair or a bare install without starting the swarm)**:

```bash
swarmforge/scripts/install_freshness_cron.sh /path/to/project-root
```

That installs an idempotent crontab line (every 2 minutes) that runs
`daemon_log_freshness_check.sh` with `FRESHNESS_ROOT` set. Re-running the
installer replaces any prior line for that same root; it never stacks
duplicates. The marker is root-scoped
(`# swarmforge-BL-675-freshness-check root=[/path/to/project-root]`), so two
project roots on the same host each keep their own line — installing for one
root never removes a sibling root's line.

Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` — from
`.swarmforge/telegram.env`, `.swarmforge/operator/telegram.env`, or
`.swarmforge/swarm.env` when those files set them, **or** from
`~/.swarmforge/fleet/<swarm_name>/telegram.json` (`botToken` / `chatId`,
the BL-436 fleet identity a normal primary actually uses). Cron starts
with none of the operator shell's env, so without the fleet fallback
announces printed `TELEGRAM_* unset` while restarts still happened. If
those are all absent, the checker still restarts and records; it only
skips the Telegram send.

Operator (during a shift) also polls babysitterd freshness
deterministically — process alive, pidfile agrees, announce path has
creds — and **tells** the coordinator / `status.json`. It does not
restart babysitterd. See [the babysitterd runbook](BL-611-babysitterd-runbook.md).

## Cron PATH and SKIP_BABYSITTERD (BL-789, Mac host-switch hotfix)

Cron's own PATH is `/usr/bin:/bin` — missing `bb`/`node`. Two consequences,
fixed 2026-08-02 (adopted/reviewed under BL-789; see
[the hotfix how-to](hotfix-2026-08-02-mac-host-switch-freshness-bridge.md)):

- **The installed crontab line bakes its own `PATH=`**, including the
  interpreter's own directory (resolved via `command -v bb` at install
  time) plus a curated fallback list. **The checker also self-establishes
  the same fallback list independently** (`FRESHNESS_EXTRA_PATH_DIRS`,
  default `/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$HOME/.npm-global/bin`,
  prepended to whatever PATH it inherited) — defense in depth, so a
  restart's `nohup bb ...` resolves `bb` even if invoked outside cron
  entirely.
- **`SWARMFORGE_SKIP_BABYSITTERD=1` is honoured by the checker itself**, not
  only `start_ancillary_services.sh`. A babysitterd deliberately never
  started this session leaves no BL-785 stop-marker (nothing ever ran to
  stop) — without this, cron restarted a daemon nobody wanted running every
  cool-off window. This is a genuinely separate predicate from
  `freshness_is_stopped` below: one is a launch-time policy (readable with
  no process ever having run), the other an explicit runtime-stop event —
  both are consulted, on purpose.

## What happens on a stale heartbeat

0. **Check for a deliberate stop** (BL-785, below). If this daemon was stopped
   on purpose, the checker returns without touching it — a stale heartbeat is
   the expected state, not a violation.
0.5. **Check the post-restart grace window** (BL-1012, above). An absent or
   heartbeat-less log within `FRESHNESS_RESTART_GRACE` seconds of a restart
   the checker itself performed is recorded as `action=grace` and nothing
   else happens.
1. **Kill** the pid named in that daemon's pid file (never pid 1 / the checker).
2. **Restart** via that daemon's own start script (never a reimplemented launch).
3. **Append** a durable incident line to
   `.swarmforge/daemon/freshness-incidents.log` **before** any network call.
   Since BL-1012 every record — `action=restart`, `action=escalate`, and
   `action=grace` — names `effective_threshold=` and `contention_factor=`
   alongside the unchanged `threshold=` (the base value, so existing readers
   keep working), so a past decision is interpretable from the record alone
   without re-running it at the same load.
4. **Announce** on Telegram via curl. The message is grep-able as
   `FRESHNESS_VIOLATION` (for composition with BL-653 escalation).

If the announce fails, the incident file is the surviving artifact.

## Deliberate stop does not get resurrected (BL-785)

The cron is unconditional once installed — it has no way to tell "operator
asked for this" from "the daemon died" apart from a durable marker the stop
and start paths maintain for it.

**The marker.** `swarmforge/scripts/freshness_stop_marker_lib.sh` manages one
file per watched daemon under `.swarmforge/daemon/freshness-stopped/`
(`<daemon-name>.stopped`). File existence only — the checker never asks a
live process, so the verdict holds with bb, node, and every swarm daemon
dead (BL-675's share-no-fate property, preserved).

| Path | Writes (marks stopped) | Clears (re-arms) |
|---|---|---|
| handoffd | `kill_pipeline_swarm.sh` | `start_handoff_daemon.sh` |
| babysitterd | `stop_ancillary_services.sh` | `start_babysitterd.sh` |

`./stop-swarm.sh` runs both stop scripts (full-stack stop), so it marks both
daemons. The pipeline-only stop (`kill_pipeline_swarm.sh` alone, including
handoffd's own endless-loop circuit breaker) marks only handoffd —
babysitterd, which that path deliberately leaves running, stays watched.

**Re-arming.** Starting a daemon clears its own marker before anything else,
so a deliberate stop never outlives the next start — the crontab line and
the watched state stay in sync.

**A crash is unaffected.** With no marker present, an unannounced death or
freeze is killed and restarted exactly as above; the marker check only ever
suppresses a restart, never triggers one.

## Cool-off

Default 300 seconds (`FRESHNESS_COOL_OFF_SECS`). A repeat violation inside the
window does **not** hammer another restart — it appends an `action=escalate`
record and announces louder. After the window, a new restart is allowed.

## Manual / test seams

```bash
FRESHNESS_ROOT=/path/to/root \
FRESHNESS_NOW_EPOCH=$(date +%s) \
/bin/sh swarmforge/scripts/daemon_log_freshness_check.sh
```

| Env | Purpose |
|---|---|
| `FRESHNESS_ROOT` | Project root (required) |
| `FRESHNESS_CONF` | Alternate conf path |
| `FRESHNESS_NOW_EPOCH` | Injected clock (unix seconds) |
| `FRESHNESS_INCIDENT_FILE` | Durable record path |
| `FRESHNESS_COOL_OFF_SECS` | Cool-off window |
| `FRESHNESS_LOAD` | Injected load average (BL-1012; default: read from the host) — pins the contention factor deterministically alongside `FRESHNESS_CORES` |
| `FRESHNESS_CORES` | Injected core count (BL-1012; default: read from the host) |
| `FRESHNESS_MAX_THRESHOLD_SECS` | Ceiling on the effective threshold (BL-1012; default 600) |
| `FRESHNESS_RESTART_GRACE` | Post-restart grace window in seconds (BL-1012; default 300) — see "Grace window" above |
| `FRESHNESS_ANNOUNCE_CMD` | Override announce (`$1` = message) |
| `FRESHNESS_KILL_CMD` | Override kill (`$1` = pid) |
| `FRESHNESS_START_CMD` | Override restart (`$1` = script, `$2` = root) |
| `FRESHNESS_EXTRA_PATH_DIRS` | Override the checker's self-established PATH prefix (BL-789; test seam) |
| `SWARMFORGE_FLEET_HOME` | Home dir containing `.swarmforge/fleet/<swarm>/telegram.json` (default `$HOME`) |

## Verify

```bash
bash swarmforge/scripts/test/test_daemon_log_freshness.sh
bash swarmforge/scripts/test/test_start_ancillary_services_freshness_cron.sh
bash swarmforge/scripts/test/test_freshness_stop_marker_lib.sh
bash swarmforge/scripts/test/test_bl785_freshness_deliberate_stop.sh
```

The first covers the checker itself; the second (BL-783) runs the real
`start_ancillary_services.sh` against fixture roots with a fake `crontab` on
PATH and reads back the installed line — proving the auto-install wiring
behaviourally, not by grepping the start script for a substring. The third
(BL-785) is a unit test of the marker library in isolation; the fourth drives
the real stop/start/checker scripts together against fixture roots to prove
the scenarios in "Deliberate stop does not get resurrected" above.

Acceptance feature: `specs/features/BL-675-daemon-log-freshness.feature`. The
deliberate-stop behaviour above has its own feature file,
`specs/features/BL-785-freshness-deliberate-stop.feature`. The
contention-relative threshold and grace window above have their own,
`specs/features/BL-1012-the-freshness-watchdog-stops-manufacturing-its-own-incidents.feature`.

## Consumer: cost-health sidecar's `daemonRestarts` (BL-904)

`.swarmforge/daemon/freshness-incidents.log` (above) has a second reader
besides this watchdog itself: the daily cost-health sidecar
(`extension/src/notify/costHealthSidecar.ts`) derives its
`reliability.daemonRestarts` figure from it, counting `action=restart`
records only per day — `action=escalate` records (a declined restart during
cool-off, see "Cool-off" above) are read but excluded, a distinct event
that would overstate restarts if folded in. A missing or unreadable log
reports as "no data" (`direction: "unknown"`, empty series), never a
fabricated zero. See the "BL-904" entry in
[the Specification](../reference/Specification.MD) for the full history —
this field was a hardcoded `0` until this ticket. No format or write-path
change here: this section only documents the new reader.

## Live e2e (operator)

1. Note handoffd's pid. `kill -STOP <pid>` (process alive, log frozen).
2. Wait past the *effective* threshold (120s at contention factor 1 — see
   "Contention-relative threshold" above; longer on a busy host, never past
   600s) plus one cron tick.
3. Confirm: new pid, incident line names `handoffd` + age +
   `effective_threshold=` + `contention_factor=`, Telegram
   `FRESHNESS_VIOLATION` arrived.
4. `kill -CONT` is unnecessary — the checker already replaced it.
5. Hold the swarm quiet past all thresholds; heartbeats keep writing and
   nothing restarts.
6. Immediately after that restart, confirm the next cron tick(s) inside
   `FRESHNESS_RESTART_GRACE` (default 300s) record `action=grace` and touch
   nothing, even though the rotated-away log still reads as absent.
