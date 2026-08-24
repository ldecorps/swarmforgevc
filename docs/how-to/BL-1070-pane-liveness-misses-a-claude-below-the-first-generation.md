# Pane liveness walks the whole tree under the pane (BL-1070)

## The gap

Babysitter decided a role was alive only when a process matching the agent
marker had **PPID = pane pid** (first generation). This pack launches

`pane sh → zsh <role>.sh → claude`

so the agent is a grandchild. Every healthy role then got

`CRIT … pane alive but NO claude process under it (half-launch/exit)`

eight times a tick, nudging the coordinator with false findings. The
half-launch detector became noise, and `check-remote-control` (gated on
`has-claude-process?`) never ran — a silenced check that said nothing.

## What changed

`agent_process_marker_lib.bb` `agent-process-line` builds a descendant set
from the same `ps -eo pid=,ppid=,args=` snapshot (BFS on ppid edges) and
matches the agent marker **anywhere under that pane**, never a process
outside the pane’s tree.

`check-remote-control` when the pane exists, RC applies, gather succeeded,
but no agent is under the pane: emits **UNAVAILABLE**
(`remote-control check could not be run — no agent process under the pane`)
instead of going quiet.

## Operator note

False eight-CRIT half-launch storms on a wrapper-launched pack should stop
after this lands. A real missing agent still CRITs half-launch; a foreign
pane’s `claude` still cannot stand in. See the babysitterd runbook check
table for the updated wording.

Acceptance:
`specs/features/BL-1070-pane-liveness-misses-a-claude-below-the-first-generation.feature`

Related: `docs/how-to/BL-611-babysitterd-runbook.md`,
`docs/how-to/BL-514-remote-control-health-and-ensure-wiring.md`.
