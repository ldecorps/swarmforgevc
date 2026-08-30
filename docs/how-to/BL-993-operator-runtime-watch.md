# BL-993: The operator-runtime watch — an always-on supervisor for `operator_runtime.bb`

Every other long-lived process in this swarm has something that keeps it
alive: handoffd has `handoffd_supervisor.bb`, the front-desk trio has
`front_desk_supervisor.bb`, the headless bridge has
`bridge_headless_supervisor.bb`. `operator_runtime.bb` had none — a crash
left a stale pidfile and the runtime stayed down indefinitely, because the
only repair path (`swarm_ensure.bb`'s `operator-healthy?` /
`ensure-operator!`) ran only when a human typed `./swarm ensure`. That gap
mattered more than an ordinary daemon death: operator-runtime is the layer
that is supposed to notice when *other* daemons die (BL-906's babysitterd
freshness watchdog runs inside it), so its own silent death was the one
failure nothing else reported.

`operator_runtime_supervisor.bb` closes that gap: a separate, always-on
process that polls operator-runtime's liveness and restarts it through its
normal entry point, with no human action required.

## Tell + restart, not tell-only

Unlike `handoffd_supervisor.bb`'s alarm-and-halt posture (BL-144) — right for
the swarm's single transport, wrong here — this watch **restarts** on a
bounded schedule and **announces** every restart on the human channel. The
human directive was explicit: leaving operator-runtime dead silently would
also defeat the babysitterd watchdog it hosts (BL-906), so restart is the
default rather than tell-only.

## What counts as healthy

`operator_runtime_watch_lib.bb`'s `healthy?` is the *one* liveness check —
shared by this watch, `swarm_ensure.bb`'s `operator-healthy?`, and
`swarm_status.bb`'s `operator-runtime` row, so none of the three can
disagree. It is stricter than a bare `kill -0`: a pidfile naming a live but
unrelated process (pid reuse after the real runtime died) reads as **down**,
because the check also verifies the live process's own command line names
`operator_runtime.bb`.

## Deliberate stops are never undone

Before touching anything, each tick checks two independent "leave it down"
signals and restarts nothing if either is set:

- `SWARMFORGE_SKIP_OPERATOR=1` — the same flag `start_operator_runtime.sh`
  and `swarm_ensure.bb` already honor.
- `.swarmforge/operator/operator-runtime-PARKED.md` — a new park-flag file,
  mirroring the front desk's own `front-desk-PARKED.md` shape. A human
  toggles it by hand (`touch` / `rm`); there is no `unpark` script.

A deliberate stop is *reported*, not silent: the watch logs and records it
as `deliberately-stopped`, naming every signal actually in effect.

## Restart is bounded and escalated

Restart attempts reuse `front_desk_supervisor_lib.bb`'s bounded-retry state
machine (the same convention `negotiation_relay_supervisor.bb` already
established), with its own env overrides:

| Env var | Meaning | Default |
|---|---|---|
| `OPERATOR_WATCH_INTERVAL_MS` | loop sleep between checks | 15000 |
| `OPERATOR_WATCH_MAX_ATTEMPTS` | bounded restart cap before giving up | 5 |
| `OPERATOR_WATCH_BACKOFF_BASE_MS` / `OPERATOR_WATCH_BACKOFF_MAX_MS` | growing delay between attempts | 2000 / 60000 |
| `OPERATOR_WATCH_HEALTHY_RESET_MS` | continuous uptime that resets the attempt counter | 600000 |
| `OPERATOR_WATCH_GIVEUP_COOLDOWN_MS` | cooldown before a re-arm after giving up | 900000 |
| `OPERATOR_WATCH_START_CMD` | substitute for `start_operator_runtime.sh` (test seam) | — |
| `OPERATOR_WATCH_NOTIFY_CMD` | substitute for the human-channel announce (test seam) | — |

A restart always goes **through** `start_operator_runtime.sh` — never a
direct `bb operator_runtime.bb` spawn — so the entry point's own
prior-runtime cleanup, log rotation, and `SWARMFORGE_SKIP_OPERATOR` gate all
still apply.

Every `:started`, `:re-armed`, and `:gave-up` event is announced on the
human channel (Telegram, when configured — otherwise the announce is still
logged and recorded, never lost). `:crashed`, `:healthy-reset`, and
`:adopted` (BL-1224, below) are logged only. `announced-event?` in
`operator_runtime_watch_lib.bb` is the single source of truth for which
events reach the human — the supervisor's own dispatch calls into it rather
than keeping an independent copy (a prior architect bounce caught exactly
that drift: see `backlog/evidence/BL-993-bounce-20260821-architect.md`).

## A deliberate restart by something else is adopted, never counted as a crash (BL-1224)

Nothing else in the swarm is supposed to restart `operator_runtime.bb`
directly — but `build_freshness_cli.bb`'s `restart-operator-group!` does,
once per QA merge (the coordinator runs a freshness sync after every merge).
Before BL-1224, every one of those deliberate restarts was indistinguishable
from a crash to this watch: `check-one!` asks only "is the tracked pid
alive", and a replaced pid answers that question identically to a dead one.
On a busy merge night this produced clusters of phantom
`crashed`/`started` announcements, climbing attempt counters, and even a
`gave-up` cooldown that left the runtime genuinely unwatched for up to 15
minutes — none of it caused by an actual failure.

Each tick now reads the runtime pidfile fresh (`:pidfile-pid`) and consults
it, in `decide`, between the deliberate-stop gate above and the crash-path
`check-one-fn`: when the pidfile names a **different, live**
`operator_runtime.bb` process (verified through the same cmdline-checked
`pid-alive?`/`runtime-alive?` this watch already uses — no second liveness
predicate), the watch **adopts** that pid and moves on. `check-one-fn` is
never reached, so an adoption spawns nothing and spends nothing: the attempt
counter is untouched, exactly as BL-1154's `voluntary-build-stale-started-entry`
already does for a voluntary build-stale roll — the same shape for a
different non-crash. `check-one!` itself is unchanged; it is shared by five
supervisors that must not be affected.

The genuine crash path is unchanged in every other case: a tracked pid that
died with the pidfile still naming it, naming nothing, or naming a live but
unrelated process (pid reuse) is still `:crashed`, still restarted through
`start_operator_runtime.sh`, and still announced. Pid reuse is deliberately
**not** adopted — the same liveness check that makes adoption safe is what
keeps a masked crash from being missed.

An adoption is logged as `:adopted` and recorded in the status file, but it
does **not** reach the human channel — it is not an incident, and training
the human to ignore a restart announcement that fires every few minutes is
exactly the credibility cost this ticket exists to stop. A post-mortem
distinguishes an adoption from a tick that did nothing by reading the log.

## The watcher is never the watched

The watch is a genuinely separate process from operator-runtime, launched
once at swarm boot by `launch_operator_runtime_supervisor.sh` (its own
pidfile: `.swarmforge/operator/operator-runtime-supervisor.pid`) and never
hosted inside, or dependent on, `operator_runtime.bb` itself. Killing the
runtime never takes the watch down with it — that is the whole point.

## Lifecycle

- **Start**: `start_ancillary_services.sh` starts the watch immediately
  after `start_operator_runtime.sh`, gated on the same
  `SWARMFORGE_SKIP_OPERATOR` flag (a swarm run with the runtime disabled has
  nothing here to watch).
- **Stop**: `stop_ancillary_services.sh`'s `stop_operator_runtime()` stops
  the watch **first**, then the runtime — in that order, deliberately. The
  watch holds no reference to the runtime's own stop-file, so stopping the
  runtime first would leave the watch to see it "die" moments later and
  restart it, undoing the deliberate stop.
- **Status**: `./swarm status`'s `operator-runtime` row now reports through
  the same strengthened `healthy?` check (so it can't disagree with the
  watch on the pid-reuse case). There is no separate status row for the
  watch process itself, matching every other supervisor in this swarm.

## Where the log and state live

```
.swarmforge/operator/operator-runtime-supervisor.pid          watch's own pidfile
.swarmforge/operator/operator-runtime-supervisor.log           append-only event log
.swarmforge/operator/operator-runtime-supervisor.status.json   current entry (pid/attempts/status), read back on restart
.swarmforge/operator/operator-runtime-supervisor.stop          transient stop-file, cleared by the launcher
.swarmforge/operator/operator-runtime-PARKED.md                deliberate-stop park flag (human-toggled)
```

The status file is read back on every tick, so a restarted supervisor
process resumes its attempt/backoff state rather than forgetting it.

## What this does not do

- It does not watch itself. If the watch process wedges or dies, nothing in
  this parcel restarts it — it is not wired into the BL-675 daemon
  log-freshness cron (`daemon_log_freshness.conf` still lists only
  `handoffd` and `babysitterd`). This mirrors the same limit BL-993's own
  spec called out for a babysitterd-hosted design: a mutual pair recovers
  either single death but not both together. Here the pair is
  "cron watches nothing new" rather than "watch B watches watch A" — worth
  knowing if the watch itself ever goes quiet.
- It does not change BL-906's babysitterd tell-never-restart contract; the
  two watches are unrelated processes with different restart postures.

## Verify

```bash
bb swarmforge/scripts/test/operator_runtime_watch_lib_test_runner.bb
bb swarmforge/scripts/test/bl993_operator_watch_acceptance_runner.bb
bb swarmforge/scripts/test/bl993_operator_watch_property_runner.bb
bash swarmforge/scripts/test/bl993_watch_survives_runtime_death.sh
bash swarmforge/scripts/test/bl993_announce_matches_predicate.sh
bash swarmforge/scripts/test/test_stop_operator_runtime_watch_first.sh
bash swarmforge/scripts/test/test_start_ancillary_services_operator_watch_gate.sh
bash swarmforge/scripts/test/test_swarm_status_operator_runtime.sh
bb swarmforge/scripts/test/bl1224_watch_adoption_property_runner.bb
bash swarmforge/scripts/test/test_operator_runtime_watch_adoption.sh
```

Acceptance features:
[`specs/features/BL-993-a-dead-operator-runtime-is-restarted-without-a-human.feature`](../../specs/features/BL-993-a-dead-operator-runtime-is-restarted-without-a-human.feature),
[`specs/features/BL-1224-watch-adopts-a-deliberately-restarted-operator-runtime.feature`](../../specs/features/BL-1224-watch-adopts-a-deliberately-restarted-operator-runtime.feature).

See also: [babysitterd — the deterministic health-sweep daemon](BL-611-babysitterd-runbook.md)
for the *other* half of the mutual-watch picture (operator-runtime tells on
a dead babysitterd, never restarts it), and the
[Non-Pipeline Agents reference table](../reference/BL-643-non-pipeline-agents-reference-table.md)
for this watch's row alongside every other launched agent in the swarm.
