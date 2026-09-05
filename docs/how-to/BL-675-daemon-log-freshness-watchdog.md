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
| cursor_bridge_supervisor | `.swarmforge/operator/cursor-bridge-supervisor.log` | 30s (2s loop) | `start_cursor_bridge.sh` |
| handoffd_supervisor | `.swarmforge/daemon/handoffd-supervisor.log` | 180s (10s loop) | `start_handoff_daemon.sh` |
| front_desk_supervisor | `.swarmforge/operator/front-desk-supervisor.log` | 30s (2s loop) | `launch_front_desk.sh` |
| negotiation_relay_supervisor | `.swarmforge/operator/negotiation-relay-supervisor.log` | 30s (2s loop) | `launch_negotiation_relay.sh` |
| onboarder_supervisor | `.swarmforge/operator/onboarder-supervisor.log` | 30s (2s loop) | `launch_onboarder.sh` |
| bridge_headless_supervisor | `.swarmforge/operator/bridge-headless-supervisor.log` | 30s (2s loop) | `start_bridge_headless.sh` |
| operator_runtime_supervisor | `.swarmforge/operator/operator-runtime-supervisor.log` | 300s (15s loop) | `launch_operator_runtime_supervisor.sh` |

(BL-784 added the six supervisor rows and per-tick heartbeats — see
[supervisor freshness heartbeats and registry guard](BL-784-supervisor-freshness-heartbeats-and-registry-guard.md).
Thresholds for supervisors are derived from each daemon's loop interval and
documented inline in the conf file.)

(BL-611 ported babysitterd into the tracked repo and moved its state from
`.swarmforge/babysitter/` to `.swarmforge/babysitterd/` — see
[the babysitterd runbook](BL-611-babysitterd-runbook.md).)

Thresholds and paths live in one place:
`swarmforge/scripts/daemon_log_freshness.conf`. These are **base**
thresholds — see "Contention-relative threshold" below for how the
*effective* threshold the checker actually applies can exceed them on a
loaded host.

Both daemons emit a timestamped, content-free `heartbeat` line so a healthy
quiet period (cooldown pause, no work) never looks dead. Since BL-784, every
registered `*_supervisor.bb` loop uses the same shape via
`daemon_log_freshness_pulse_lib.bb` — a conf row without that heartbeat would
restart a healthy supervisor for being quiet.
`handoffd` writes it **twice per cycle — at the start AND the end** (BL-789):
observed Mac cycles run 140-232s, close to/past the 120s threshold, so a
start-of-cycle pulse is what keeps a merely-slow cycle from looking
identical to a wedged one until the whole cycle finishes.
`babysitterd` uses the same start+end shape, plus a cold-start pulse before
the first tick (BL-1133): its 600s base threshold still trips a truly mute
log, but a long mid-tick gather (e.g. pipeline-code-on-main) or host sleep
across `sleep` no longer floods Operator with false
`FRESHNESS_VIOLATION … stale-heartbeat` cool-off escalates.

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

## In-flight sweep suppress (BL-1110)

`handoffd` refreshes its log heartbeat only at cycle start and end. A heavy
mid-cycle sweep can age that heartbeat past the 120s base budget while the
daemon is still progressing — the supervisor already trusted
`.swarmforge/daemon/handoffd.sweep-marker` for that case; the freshness cron
did not, and restarted a live delivery loop (`stale-heartbeat` → flap).

When the marker shows an in-flight sweep younger than the in-sweep budget
(`FRESHNESS_IN_SWEEP_BUDGET_MS`, default 225000 ms — same default as the
supervisor's BL-977 budget), the checker records
`action=suppress-in-sweep` / `reason=in-sweep-progress` and does **not**
restart. A truly wedged daemon that stops refreshing the marker still trips
`stale-heartbeat` as before. The conf pin stays `handoffd|120` — this is not
a threshold bump.

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

## The watchdog for the watchdog: is the cron daemon itself alive? (BL-1392)

Everything above assumes the installed crontab line actually fires. Nothing
did until this ticket — on a WSL2 host with no `[boot]` command in
`/etc/wsl.conf`, cron itself stopped on 2026-08-30 and every `./swarm start`
since printed "Installed" over a dead scheduler: this freshness watchdog
was off for five days (it restarts a dead `handoffd`, but nothing restarts
a dead `cron`), every shift start and bedtime was manual, and a scheduled
bedtime silently never fired. Two halves, because an install-time check is
green at start and blind afterwards (the same BL-1235 shape every
consumer-anchor rule in this repo warns about):

- **Install-time**: `install_swarmforge_crons.sh` (every `./swarm start`
  runs it) now probes for a live `cron`/`crond` process
  (`pgrep -x cron`/`crond`; on macOS launchd keeps `/usr/sbin/cron` running
  whenever a crontab exists, so the same probe works there). No daemon
  found → prints `CRON_DAEMON_DOWN` naming the host fix (`sudo service cron
  start`, plus the `/etc/wsl.conf` `[boot]` line so it survives a WSL
  restart) and exits non-zero — `start_ancillary_services.sh` already
  echoes a WARN on a non-zero installer, so the marker reaches launch
  output unchanged. The crontab lines are still written even on this
  refusal: they fire the moment cron starts, so a later manual `sudo
  service cron start` needs no re-install.
- **Runtime**: a `handoffd` sweep (`cron-heartbeat-stale`,
  `cron_heartbeat_lib.bb`) reads the mtime of THIS SAME freshness cron log
  (`.swarmforge/daemon/freshness-check.cron.log`, above) against a 10-minute
  bound (the freshness cron's own 2-minute cadence, with slack for a slow
  host or a tick landing either side of the boundary) — the one signal that
  catches cron dying AFTER a clean install, since nothing else notices a
  process cron itself never runs. Escalates once per episode past the
  bound (or if the log has never existed at all, its own `absent-escalate`
  reading, worded differently so the message says which it saw), stays
  quiet while already escalated (a repeat every tick is noise, not news),
  and a fresh log clears the episode so a later death escalates again
  (BL-920 self-healing, the same shape this watchdog's own restart/cool-off
  state already uses). An unreadable mtime is its own `:unknown` verdict —
  never read as evidence of death OR of life.

**The swarm never starts cron itself** (invariant 3, unchanged by either
half) — starting a system daemon needs root, and doing it automatically is
explicitly out of scope. Both halves only ever report and name the fix.

Acceptance:
`specs/features/BL-1392-a-dead-cron-daemon-is-never-silent.feature`.

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

## Reading past a NUL byte (BL-1413)

`heartbeat_age_secs` reads the log with `LC_ALL=C grep -aE` (text mode,
byte-wise), not plain `grep -E`. GNU grep treats any file containing a NUL
byte as binary: it stops at the first NUL, prints `binary file matches` to
stderr, and never sees a heartbeat line written after it. A crash that
zero-fills part of a log (observed 2026-08-30, one NUL-bearing line in each
of five supervisor logs) made the checker read the last heartbeat *before*
that byte — sometimes days stale — while the daemon was actually healthy:
once cron itself came back (BL-1392, above) it restarted five healthy
supervisors and announced `FRESHNESS_VIOLATION` every two-minute tick, ~120
false alarms an hour, until this fix. `-a` makes every heartbeat line after
a NUL visible again, on both GNU and BSD grep.

A NUL byte (or a torn line, or invalid UTF-8) can still make **that one
line's own timestamp** fail to parse. `heartbeat_age_secs` walks the
matched lines newest-to-oldest and uses the first one whose timestamp
actually parses — an unparseable newest line falls back to an older,
parseable heartbeat rather than returning the `unparseable-timestamp`
sentinel; only a file with **no** parseable heartbeat line at all still
returns that sentinel. A byte can make one line unreadable; it can never
hide every line after it.

## Attribution: swarm name and violation reason (BL-1011)

`heartbeat_age_secs` returns a huge sentinel age (`999999999`) for three
different, unmeasurable conditions — the log file is missing, the log has no
heartbeat line, or the newest heartbeat's timestamp will not parse — and
that sentinel used to reach the operator raw, printed as though it were a
real age, with no indication of which of the three had happened. Every
announce and every durable incident record now carries two more fields:

- **`swarm=`** — this checkout's swarm name, resolved once, unconditionally,
  before either the Telegram credential fallback or any violation check
  runs. Previously the resolution lived *only* inside the branch that fills
  in missing `TELEGRAM_*` credentials, so a checkout whose credentials were
  already exported never computed it and announced anonymously — exactly
  what stalled attribution of the five `age_secs=999999999` alarms received
  on 2026-08-21. Resolution order: `SWARMFORGE_SWARM_NAME`, then
  `swarm_name` from `.swarmforge/swarm-identity`, then the fallback
  `primary` — it is never empty, because an unattributable alarm is the
  defect this fixes.
- **`reason=`** — which condition produced the age: `log-absent`,
  `no-heartbeat-line`, `unparseable-timestamp`, or (the normal, non-sentinel
  case) `stale-heartbeat`.

And `age_secs=` itself no longer ever prints the raw `999999999` sentinel to
a person — a value that is not a real age renders as the word `unknown`; a
real measured age still renders as a number, unchanged.

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
   without re-running it at the same load. Since BL-1011 every record also
   names `swarm=` and `reason=`, and `age_secs=` is the word `unknown`
   instead of a raw sentinel — see "Attribution" above. Example:
   `epoch=1785625446 swarm=primary daemon=babysitterd age_secs=unknown
   reason=log-absent threshold=600 effective_threshold=600
   contention_factor=1 action=restart`.
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

Since BL-1162, a successful `./stop-swarm.sh` also removes every other
root-scoped swarmforge cron line (schedule start/stop/bedtime), not only
freshness — see
[BL-1162 symmetric cron lifecycle](BL-1162-start-stop-swarm-cron-lifecycle-symmetry.md).

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

The freshness shell suites bind `CONF` to the tracked fixture
`swarmforge/scripts/test/fixtures/daemon_log_freshness.fixture.conf`, **not**
the live `daemon_log_freshness.conf` (BL-1000) — so an ops raise of handoffd's
threshold cannot redden stale-heartbeat asserts. See
`docs/how-to/BL-1000-freshness-tests-read-a-pinned-fixture.md`.

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
The swarm/reason attribution above has its own,
`specs/features/BL-1011-a-freshness-alarm-names-its-swarm-and-its-reason.feature`,
plus a property test that runs the real script as a subprocess against
generated checkouts, `swarmforge/scripts/test/bl1011_freshness_attribution_property_runner.bb`
— the defect was about which shell branch computed a variable, which only
running the script can answer.
The NUL-byte read above has its own,
`specs/features/BL-1413-the-freshness-check-reads-past-a-nul-byte.feature`,
plus a property runner
(`swarmforge/scripts/test/bl1413_freshness_nul_byte_property_runner.bb`)
and trimmed excerpts of the five real 2026-09-05 supervisor logs around
their NUL-bearing line, checked in under
`swarmforge/scripts/test/fixtures/bl1413/`.

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
3. Confirm: new pid, incident line names `handoffd` + age (or `unknown` +
   `reason=`) + `swarm=` + `effective_threshold=` + `contention_factor=`,
   Telegram `FRESHNESS_VIOLATION` arrived naming the same swarm and reason.
4. `kill -CONT` is unnecessary — the checker already replaced it.
5. Hold the swarm quiet past all thresholds; heartbeats keep writing and
   nothing restarts.
6. Immediately after that restart, confirm the next cron tick(s) inside
   `FRESHNESS_RESTART_GRACE` (default 300s) record `action=grace` and touch
   nothing, even though the rotated-away log still reads as absent.
