# BL-637 — Lifecycle script scope (honest names + verified stop)

## Which stop do I want?

| Goal | Entry point | Scope |
|---|---|---|
| Park the pipeline, keep Telegram / operator visibility | `./swarm-kill` or `kill_pipeline_swarm.sh` | **pipeline-only** |
| End of day: stop the token burn, keep the phone reachable (bedtime) | `./finish-shift` | pipeline + babysitterd + operator runtime + onboarder — **Telegram front desk and remote tunnels kept up** |
| Tear everything down for offline work | `./stop-swarm.sh` | **full stack** (including the phone path) |
| Bring everything back | `./start-swarm.sh` | **full stack** |

`./finish-shift` (BL-762) is the bedtime verb: unlike `stop-swarm.sh`, it
deliberately leaves the Telegram front desk and remote tunnels running, so
Bubble does not lose its origin and read as dead overnight. See
[Bedtime vs. lights-out](BL-762-finish-shift-bedtime-vs-lights-out.md) for
the full keep-vs-kill table.

`kill_all_swarm.sh` is a **legacy alias** for `kill_pipeline_swarm.sh`. It prints a
one-line pointer and does **not** mean “kill all of SwarmForge”.

## Verified full-stack stop

After ancillaries + pipeline teardown, `./stop-swarm.sh` scans live processes
(parsing `ps`, never `pgrep -f`) for:

- any `babysitterd.sh` (including operator-launched copies)
- any `--remote-control Operator` agent

If either survives it prints `REFUSE: … named survivors: …` and exits non-zero —
it never prints `full stack SUCCESS — no known survivors` in that case.

`./stop-swarm.sh` also refuses to report a clean stop if the pipeline kill
itself exited non-zero: it prints `REFUSE: pipeline stop exited $kill_rc; not
reporting a finished clean stop` and exits with that same non-zero code — a
second, independent refuse gate alongside the survivor scan above. Both gates
must pass before the success line prints.

## Discoverability

Every `swarmforge/scripts/start_*.sh` and `launch_*.sh` `--help` names the
matching stop path. Babysitterd has no `stop_babysitter.sh`; stop lives in
`stop_ancillary_services.sh` / `./stop-swarm.sh`, and `--help` says so.
