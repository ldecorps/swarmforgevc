# BL-675: Daemon log-freshness watchdog

**Process liveness lies.** A futex-wedged or mute-loop daemon can keep its pid
alive while its log freezes — and every in-process watcher shares that fate.
This watchdog is the share-no-fate pulse: a cron-scheduled POSIX script that
restarts wedged sweep daemons from outside bb/node/the swarm.

## What it watches

| Daemon | Log | Threshold | Start script |
|---|---|---|---|
| handoffd | `.swarmforge/daemon/handoffd.log` | 120s | `start_handoff_daemon.sh` |
| babysitterd | `.swarmforge/babysitter/runtime.log` | 600s | `start_babysitter.sh` |

Thresholds and paths live in one place:
`swarmforge/scripts/daemon_log_freshness.conf`.

Both daemons emit a timestamped, content-free `heartbeat` line on every loop
tick, so a healthy quiet period (cooldown pause, no work) never looks dead.

## Install (once per host)

```bash
swarmforge/scripts/install_freshness_cron.sh /path/to/project-root
```

That installs an idempotent crontab line (every 2 minutes) that runs
`daemon_log_freshness_check.sh` with `FRESHNESS_ROOT` set. Re-running the
installer replaces any prior BL-675 line; it never stacks duplicates.

Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in
`.swarmforge/telegram.env` or `.swarmforge/operator/telegram.env` for
announces. If those are unset, the checker still restarts and records; it
only skips the Telegram send.

## What happens on a stale heartbeat

1. **Kill** the pid named in that daemon's pid file (never pid 1 / the checker).
2. **Restart** via that daemon's own start script (never a reimplemented launch).
3. **Append** a durable incident line to
   `.swarmforge/daemon/freshness-incidents.log` **before** any network call.
4. **Announce** on Telegram via curl. The message is grep-able as
   `FRESHNESS_VIOLATION` (for composition with BL-653 escalation).

If the announce fails, the incident file is the surviving artifact.

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
| `FRESHNESS_ANNOUNCE_CMD` | Override announce (`$1` = message) |
| `FRESHNESS_KILL_CMD` | Override kill (`$1` = pid) |
| `FRESHNESS_START_CMD` | Override restart (`$1` = script, `$2` = root) |

## Verify

```bash
bash swarmforge/scripts/test/test_daemon_log_freshness.sh
```

Acceptance feature: `specs/features/BL-675-daemon-log-freshness.feature`.

## Live e2e (operator)

1. Note handoffd's pid. `kill -STOP <pid>` (process alive, log frozen).
2. Wait past 120s + one cron tick.
3. Confirm: new pid, incident line names `handoffd` + age, Telegram
   `FRESHNESS_VIOLATION` arrived.
4. `kill -CONT` is unnecessary — the checker already replaced it.
5. Hold the swarm quiet past all thresholds; heartbeats keep writing and
   nothing restarts.
