# Parcel Flow

This is the pipeline every agent follows. Each work item ("parcel") moves down a
single ordered chain of roles. Read your own `swarmforge/roles/<role>.prompt` for
the substance of your stage; this file is only the flow between stages.

## Notify chain

```
specifier ─► coder ─► cleaner ─► architect ─► hardender ─► documenter ─► QA (integrate) ─► coordinator (bookkeep)
```

The **coordinator** sits outside the forward chain: it controls intake, routes
the first parcel to the specifier, tracks which stage holds the parcel, unblocks
stalls, and — after QA approval — performs backlog bookkeeping (move ticket to
`done/`, promote the next item). It does NOT merge to `main` or push — QA lands
the approved commit on `main` itself (BL-247).

The **specifier** writes specifications only. It does not merge, close tickets,
or promote backlog items.

## Roles, worktrees, receive mode

| Role | Worktree | Receive mode | Hands parcel to |
|------|----------|--------------|-----------------|
| **coordinator** | master (no domain code) | task | specifier *(intake/routing)*; backlog bookkeeping after QA (no git merge/push) |
| **specifier** | master | task | **coder** — specifications only |
| **coder** | `coder` | task | **cleaner** |
| **cleaner** | `cleaner` | batch | **architect** |
| **architect** | `architect` | task | **hardender** |
| **hardender** | `hardender` | batch | **documenter** |
| **documenter** | `documenter` | task | **QA** |
| **QA** | `QA` | task | **coordinator** *(approval + merge-up broadcast)*; lands the approved commit on `main` |

- The specifier works on **master** but only for spec/prompt files — not integration merges.
- Every other pipeline role works only in its own `.worktrees/<role>` branch.
- **QA** is the integration point: after the merge-up broadcast it lands the approved commit on `main` and pushes origin (BL-247).
- The coordinator never commits domain code and runs no git merge/push; after QA it does backlog bookkeeping only (move ticket, promote next).

## How a parcel moves

1. The **specifier** writes the spec into `backlog/paused/` and notifies the
   **coordinator**. The specifier does not activate work itself.
2. The **coordinator** promotes an eligible item into `backlog/active/` (respecting
   `active_backlog_max_depth`) and routes it to the **specifier** or **coder** as
   appropriate for the pack.
3. Each stage does its work in its own worktree, commits, then sends a
   `git_handoff` (priority `00`) to the next role in the chain, preserving the
   parcel's stable task name.
4. After the **cleaner**, the **architect** reviews architecture, the
   **hardender** does mutation hardening, the **documenter** updates docs, and
   **QA** runs the final gate.
5. **QA** is the last quality gate. On pass it:
   - Broadcasts a `note` to every pipeline worktree role (`coder`, `cleaner`,
     `architect`, `hardender`, `documenter`) instructing each to **merge its own
     branch up to QA's approved commit** — not to `main`.
   - **Lands the approved commit on `main`** itself and pushes origin (same
     session), and closes the GitHub issue if the ticket is `GH-`-seeded
     (BL-247: QA is the integration point).
   - Sends a `git_handoff` or `note` to the **coordinator** with the QA-approved
     commit and task id so it does the backlog bookkeeping.
6. The **coordinator** then (backlog bookkeeping only — no git merge/push):
   - Moves the backlog item from `backlog/active/` to `backlog/done/`.
   - Rechecks `active_backlog_max_depth` and promotes the next paused item if a
     slot is open.
7. A role must **not** forward a `git_handoff` when the received commit produces
   no functional project change. It completes the inbound task instead (see
   `handoff-protocol.md`).

## Sending and receiving

- Send only via `swarm_handoff.sh <draft-file>`; never write to `inbox/new/`.
- Receive by running `ready_for_next.sh`, which dispatches to the task or batch
  helper configured for your role.
- The full draft format, message types, queue helpers, and audit rules are in
  `swarmforge/handoff-protocol.md`.
