# Supervisor freshness heartbeats and registry guard (BL-784)

*How-to. Task-oriented: register every long-running supervisor loop for
BL-675 log-freshness watching without restarting healthy quiet daemons.*

BL-675's cron checker (`daemon_log_freshness_check.sh`) only helps daemons
listed in `daemon_log_freshness.conf`. Before BL-784, six `*_supervisor.bb`
loops ran unwatched — and adding conf rows alone would have **restarted healthy
supervisors**, because those loops logged only on errors and state transitions,
not on idle ticks.

BL-784 closes the class in three layers (order matters: heartbeat first, row
second):

1. **Per-tick heartbeats** — `daemon_log_freshness_pulse_lib.bb` appends an
   ISO timestamp `heartbeat` line on every loop tick, even when the supervisor
   does no work.
2. **Conf rows** — each supervisor gets a threshold derived from its own
   `interval_ms` (documented inline in `daemon_log_freshness.conf`).
3. **Registry guard** — `daemon_log_freshness_registry_guard.sh` fails closed
   before the checker runs if a required daemon lacks a row or an unclassified
   `*_supervisor.bb` exists.

Depends on BL-783 (cron installer wired into lifecycle start) for observable
behaviour in production; the heartbeats and rows are inert until cron runs.

## Watched supervisors (BL-784)

| Daemon | Loop interval | Threshold | Log / pid under `.swarmforge/` |
| --- | --- | --- | --- |
| `cursor_bridge_supervisor` | 2s | 30s | `operator/cursor-bridge-supervisor.{log,pid}` |
| `front_desk_supervisor` | 2s | 30s | `operator/front-desk-supervisor.{log,pid}` |
| `negotiation_relay_supervisor` | 2s | 30s | `operator/negotiation-relay-supervisor.{log,pid}` |
| `onboarder_supervisor` | 2s | 30s | `operator/onboarder-supervisor.{log,pid}` |
| `bridge_headless_supervisor` | 2s | 30s | `operator/bridge-headless-supervisor.{log,pid}` |
| `handoffd_supervisor` | 10s | 180s | `daemon/handoffd-supervisor.{log,pid}` |
| `operator_runtime_supervisor` | 15s | 300s | `operator/operator-runtime-supervisor.{log,pid}` |

`handoffd` and `babysitterd` rows are unchanged from BL-675. Full checker
behaviour (contention scaling, grace window, deliberate-stop markers) lives in
[BL-675 daemon log-freshness watchdog](BL-675-daemon-log-freshness-watchdog.md).

**Do not confuse layers:** `cursor_bridge_supervisor` already wrote an inner
`cursor-bridge-heartbeat.json` for the bridge child. BL-784 watches the
**supervisor process itself**.

## Registry guard

`daemon_log_freshness_required.conf` lists every daemon that must have a conf
row. The guard script:

- fails if a required name is missing from `daemon_log_freshness.conf`;
- fails if any `*_supervisor.bb` in `swarmforge/scripts/` is not registered
  (unclassified script → fail closed, never assume fine).

`daemon_log_freshness_check.sh` invokes the guard on every run before checking
heartbeats.

## Modules

| Piece | Location |
| --- | --- |
| Heartbeat helper | `swarmforge/scripts/daemon_log_freshness_pulse_lib.bb` |
| Conf rows | `swarmforge/scripts/daemon_log_freshness.conf` |
| Required set | `swarmforge/scripts/daemon_log_freshness_required.conf` |
| Guard | `swarmforge/scripts/daemon_log_freshness_registry_guard.sh` |
| Supervisor wiring | `*_supervisor.bb` — `append-log-heartbeat!` each tick |

## Verify

```bash
bb swarmforge/scripts/test/daemon_log_freshness_pulse_lib_test_runner.bb
bash swarmforge/scripts/test/test_daemon_log_freshness.sh
```

## Siblings

- [BL-675 daemon log-freshness watchdog](BL-675-daemon-log-freshness-watchdog.md) — checker, cron install (BL-783), thresholds, restart policy
- BL-783 — freshness cron wired into `start_ancillary_services.sh`
