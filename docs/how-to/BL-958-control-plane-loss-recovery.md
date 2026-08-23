# BL-958 — Recover from control-plane loss (tmux server gone, daemons still up)

Task-oriented runbook for one specific crash class. If the swarm died
**seconds after launch** rather than mid-run, you want
[BL-657](BL-657-launcher-tmux-server-dies-seconds-after-launch.md) instead —
different cause, different fix.

## Recognise the shape

All of these hold at once:

- `./swarm status .` reports every role **DOWN**.
- `handoffd`, `handoffd-supervisor`, the front desk, and `babysitterd` are all
  **UP** and healthy — `.swarmforge/daemon/handoffd.status.json` looks fine.
- `handoffd`'s log carries repeated `tmux send-literal failed` chase errors.
- The socket file `.swarmforge/tmux-socket` **still exists**.
- `tmux -S .swarmforge/tmux-socket ls` answers `no server running`.
- `.swarmforge/control-pause.json` has `"active": false` — this is not a
  policy pause.

That combination is the control-plane-loss shape: the tmux server died under a
swarm that still believes it is running. It is abnormal by construction — a
normal stop (`kill_pipeline_swarm.sh`) removes both the socket file *and*
`sessions.tsv`, so a surviving socket alongside surviving role metadata can
only mean the server went away on its own.

## What the swarm now tells you by itself

Since BL-958 you should not have to assemble that list by hand.

**`./swarm status .`** replaces the per-role rows with a single
`control-plane` row:

```
control-plane   control-plane-missing   tmux server not responding;
socket=<path>; role metadata still present; run ./swarm ensure
```

The per-role rows are deliberately *not* shown. With the server gone there is
no live truth about any individual role, and rendering DOWN for each from
stale `sessions.tsv` metadata is exactly the misdiagnosis the live 2026-08-19
incident produced.

**`.swarmforge/incidents/control-plane.json`** carries the evidence. The first
chase send that fails writes one open incident — socket path, the probe's own
output, the sessions that were expected, when it was observed, and which
component saw it — with the response decision embedded. At most one incident
is open at a time, so a chase storm records the loss once rather than once per
retry. A corrupt or unreadable store degrades to empty rather than taking the
chase sweep or `status` down with it.

## Recover

```
./swarm ensure .
```

`ensure` classifies through the same library `status` did, so the two cannot
disagree, and then takes one of two paths:

| Persisted launch scripts in `.swarmforge/launch/` | What `ensure` does |
|---|---|
| present | **Recreates the role sessions** from them. Creating the first session restarts the tmux server itself — there is no separate "start the server" step. |
| absent | **Halts.** Recreation is impossible, so it does not churn through per-role repairs that cannot work. |

`ensure` then re-probes and reports honestly:

- `control-plane FIXED` — only when the server actually answers again. Open
  incidents are resolved at that point.
- `control-plane FAILED` — the reason, plus the concrete next action. Under
  the halt path that next action is *relaunch the swarm
  (`./start-swarm.sh`) and inspect
  `.swarmforge/incidents/control-plane.json` for the evidence*.

A `FIXED` verdict requires a recovery that actually restored roles. A tmux
server that merely answers a probe is **not** enough to close an incident —
under the halt path the open incident is left untouched on purpose, so a
failed restart can never retract the record of the loss.

## Who owns the response

**`babysitterd`.** The ownership question was settled by the live incident the
hard way: `operator-runtime` was itself down or stale while the control plane
was gone, so the owner cannot be a daemon that this same failure shape can
take out. Pane liveness is `babysitterd`'s whole job. `operator-runtime`'s
absence during the incident was parallel damage, not a missed detection.

The owner gets exactly one deterministic action — recover when launch scripts
exist to respawn from, otherwise escalate once carrying the reason and the
next action. Never repeated silent degradation.

For the daemon-side mechanics of that automatic recovery — the attempt/cooldown
bound, the wall-clock timeout on `./swarm ensure` itself, and the `REPAIR
[repaired|failed|unfinished] control-plane` log line — see
[the babysitterd runbook](BL-611-babysitterd-runbook.md#control-plane-auto-heal-bounded-in-time-bl-958bl-1071).

## Verify

```
bb swarmforge/scripts/test/control_plane_lib_test_runner.bb
bb swarmforge/scripts/test/bl958_control_plane_property_runner.bb
```

The acceptance contract is
`specs/features/BL-958-full-forge-tmux-control-plane-crash-root-cause.feature`.
