# Parcel Flow

This is the pipeline every agent follows. Each work item ("parcel") moves down a
single ordered chain of roles. Read your own `swarmforge/roles/<role>.prompt` for
the substance of your stage; this file is only the flow between stages.

## Notify chain

```
specifier ─► coder ─► cleaner ─► architect ─► hardender ─► documenter ─► QA ─► specifier (merge)
```

The **coordinator** sits outside the forward chain: it controls intake, routes
the first parcel to the specifier, tracks which stage holds the parcel, unblocks
stalls, and decides when an item is PR-ready.

## Roles, worktrees, receive mode

| Role | Worktree | Receive mode | Hands parcel to |
|------|----------|--------------|-----------------|
| **coordinator** | master (no code) | task | specifier *(intake/routing only)* |
| **specifier** | master | task | **coder** — and merges QA-approved work |
| **coder** | `coder` | task | **cleaner** |
| **cleaner** | `cleaner` | batch | **architect** |
| **architect** | `architect` | task | **hardender** |
| **hardender** | `hardender` | batch | **documenter** |
| **documenter** | `documenter` | task | **QA** |
| **QA** | `QA` | task | **specifier** (final gate → merge) |

- The specifier works on **master** (the integration branch).
- Every other pipeline role works only in its own `.worktrees/<role>` branch.
- The coordinator never commits target code; it orchestrates only.

## How a parcel moves

1. The **coordinator** promotes an eligible backlog item and routes it to the
   **specifier** (respecting `active_backlog_max_depth` in `swarmforge.conf`).
2. Each stage does its work in its own worktree, commits, then sends a
   `git_handoff` (priority `00`) to the next role in the chain, preserving the
   parcel's stable task name.
3. After the **cleaner**, the **architect** reviews architecture, the
   **hardender** does mutation hardening (cover the uncovered, kill survivors,
   final CRAP/DRY), the **documenter** updates docs, and **QA** runs the final
   gate.
4. **QA** is the last of the pack and the final quality gate. On pass it forwards
   the approved parcel to the **specifier**, who merges it into `main`.
5. A role must **not** forward a `git_handoff` when the received commit produces
   no functional project change. It completes the inbound task instead (see
   `handoff-protocol.md`).

## Sending and receiving

- Send only via `swarm_handoff.sh <draft-file>`; never write to `inbox/new/`.
- Receive by running `ready_for_next.sh`, which dispatches to the task or batch
  helper configured for your role.
- The full draft format, message types, queue helpers, and audit rules are in
  `swarmforge/handoff-protocol.md`.
