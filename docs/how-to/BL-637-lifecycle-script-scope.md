# BL-637 — Lifecycle script scope (honest names + verified stop)

## Which stop do I want?

| Goal | Entry point | Scope |
|---|---|---|
| Park the pipeline, keep Telegram / operator visibility | `./swarm-kill` or `kill_pipeline_swarm.sh` | **pipeline-only** |
| Tear everything down for offline work | `./stop-swarm.sh` | **full stack** |
| Bring everything back | `./start-swarm.sh` | **full stack** |

`kill_all_swarm.sh` is a **legacy alias** for `kill_pipeline_swarm.sh`. It prints a
one-line pointer and does **not** mean “kill all of SwarmForge”.

## Verified full-stack stop

After ancillaries + pipeline teardown, `./stop-swarm.sh` scans live processes
(parsing `ps`, never `pgrep -f`) for:

- any `babysitterd.sh` (including operator-launched copies)
- any `--remote-control Operator` agent

If either survives it prints `REFUSE: … named survivors: …` and exits non-zero —
it never prints `full stack SUCCESS — clean slate` in that case.

## Discoverability

Every `swarmforge/scripts/start_*.sh` and `launch_*.sh` `--help` names the
matching stop path. Babysitterd has no `stop_babysitter.sh`; stop lives in
`stop_ancillary_services.sh` / `./stop-swarm.sh`, and `--help` says so.
