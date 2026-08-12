# Raw intake — orphan janitor doesn't reclaim leaked `caffeinate -dims` daemons

Status: new intake, not minted. Capture only (human, via chat with the
coordinator, 2026-08-12 ~09:52 CEST).

## Human ask (verbatim)

"Can you check what the CPUs are doing? I suspect orphan processes
running?" followed by, after the coordinator's findings were reported,
"can you extend the correct janitor scope to catch those?"

## Coordinator investigation (this session)

- Host load average at the time: **178.82 / 149.53 / 118.54** on a
  **4-core** machine, with CPU itself only 49% user + 27% sys (24% idle)
  — the mismatch points at scheduling/queue pressure, not pure compute
  saturation.
- Two distinct findings surfaced:
  1. **The load spike itself** was live, concurrent `vitest` property-lane
     runs (multiple `npm exec vitest run --config
     vitest.properties.config.mjs` invocations at once, each fanning out
     into several `tinypool` workers). This is the known, already-ticketed
     gap — **BL-871** ("property lane worker pool cap"), currently active
     in the pipeline, unresolved. Not this intake's scope.
  2. **51 stray `caffeinate -dims` processes**, all reparented to
     `launchd` (PPID 1), running continuously for 2-4 days each (oldest
     since 2026-08-08), with no timeout (`-dims` never expires on its
     own). This IS a real, distinct leak — separate from BL-871.

## Root cause of the caffeinate leak (traced)

- Producer: `swarmforge/scripts/launch_resident_spy_tunnel.sh`'s
  `ensure_tunnel_caffeinate()` spawns a detached `caffeinate -dims`,
  tracked via a pidfile (`$OP/resident-spy-caffeinate.pid`).
- Intended teardown: `swarmforge/scripts/stop_ancillary_services.sh`
  signals that same pidfile on clean shutdown.
- The gap: pidfile-based tracking only reaches ONE caffeinate process at a
  time. Any crash, force-kill, or unclean host-switch between launch and
  stop — or a second launch overwriting the pidfile before the previous
  process was signaled — orphans the prior `caffeinate -dims` with no
  remaining reference to it anywhere. Nothing periodically re-scans for
  these, so they accumulate silently (51 over ~5 days on this host).

## Why this is the janitor's scope, not a one-off script

`swarmforge/scripts/orphan_janitor_lib.bb` /
`orphan_janitor_sweep_lib.bb` already exist as the standing periodic
safety net for exactly this class of problem — leftover processes the
primary teardown path (pidfile signal, fixture reaper, etc.) misses —
loaded on `operator_runtime.bb`'s always-alive tick. That's almost
certainly "the correct janitor scope" the human is asking to extend,
rather than inventing a second reclaim mechanism.

**Open design question for the specifier**: every existing janitor
candidate class is identified by a *disposable-root path signature*
(`tmp.*`/`aps-*`/`sfvc-*`/`bl\d+-*` under `/tmp` or Darwin
`$TMPDIR/…/T/`) — see `disposable-root-re` in `orphan_janitor_lib.bb`.
`caffeinate -dims`'s own cmdline carries no such signature (no path, no
identifying argument), so a naive `comm == caffeinate && ppid == 1` match
would also catch a caffeinate a human started manually outside the swarm.
The existing pidfile (`$OP/resident-spy-caffeinate.pid`) is the only
reliable "this one is ours" signal available — the sweep should likely
key off that pidfile (stale/mismatched-PID detection) rather than a bare
process-table pattern match, to preserve the janitor's existing
decapitation guardrail (never touch a process the swarm can't prove it
owns).

## Out of scope for this ticket

- BL-871's property-lane worker-pool cap (separate, already active).
- Any change to how/why `caffeinate` is launched in the first place —
  this is about reclaiming what's already leaked, not changing the launch
  path.
- Killing anything not traceable to the swarm's own pidfile record.

## Not yet done

The 51 currently-live orphans have NOT been killed — the human's ask was
about extending the janitor (a durable fix), not an immediate manual
cleanup. If an immediate one-off cleanup is also wanted, that's a
separate, explicit ask.
