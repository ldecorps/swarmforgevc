# BL-1089 — documenter pass — 20260824 (Article 4.4: NONE)

Received hardener tip `16d8dabb16` (`merge_and_process hardender 16d8dabb16`).
Fast-forwarded into the documenter worktree. Parcel task name is BL-1089 only.

## Scope (what the parcel changed)

Repair `test_front_desk_supervisor_liveness.sh` so its "stopped listening"
heartbeat is stamped after the child's own spawn (BL-1035 own-heartbeat
semantics), then aged past the stall window. APS steps, property cover, and a
hand mutation sweep pin the cascade. Production
`front_desk_supervisor.bb` / `front_desk_supervisor_lib.bb` are untouched —
no user-facing product behavior, commands, settings, or flows introduced or
altered.

## Documentation checklist

| Check | Result |
|---|---|
| Ticket-named doc deliverables | None beyond the acceptance feature |
| README / command lists / settings docs | No front-desk liveness fixture prose to update |
| `docs/how-to/`, `docs/reference/`, `docs/explanation/`, `docs/tutorials/` | Spec already records BL-370 outage cover and BL-1035 own-heartbeat; nothing claims the stale pre-spawn fixture shape; no contradictory page found |
| Architecture / swarm-flow diagrams (`docs/diagrams/`) | Topology unchanged — no diagram edit |
| Prior bounce history (`main`, ahead of `origin/main`) | No BL-1089 bounce; no open documenter-blamed item |

## Inventory

NONE.

No docs invent. Commit this explicit-NONE evidence (Article 4.4 / BL-536) and
`git_handoff` to QA naming that commit, same task name, priority `00`.

By documenter.
