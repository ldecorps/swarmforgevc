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
the approved commit on `main` itself (BL-247). An active ticket with no `assigned_to` is nudged to the coordinator by `handoffd`'s unassigned-active sweep (see `swarmforge/handoff-protocol.md`); the daemon never assigns for it.

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


## Mono-router idle and open slots

Mono-router packs (`config rotation sequential`, e.g. `perplexity-mono-router`,
`cerebras-mono-router`, `codex-mono-router`) keep **one resident** process
(usually **coder** as home) and rotate other pipeline roles in on demand. The
coordinator remains a separate always-on pane.

When the home resident runs `ready_for_next.sh` and gets `NO_TASK`:

1. **Stop.** Do not re-poll, invent a `/loop`, or burn tokens waiting.
2. If `backlog/*.yaml` root intakes exist → rotate to **specifier**.
3. Else if `backlog/active/` is empty and `backlog/paused/` has eligible work →
   send **one** `note` to the coordinator asking it to promote and route, then
   idle for a wake.
4. The coordinator, on wake with capacity under `active_backlog_max_depth`,
   promotes and routes — it does not wait for a human chat turn.

Promotion is still coordinator-owned (file move `paused/` → `active/`); there
is no separate daemon that fills open slots on its own.


## Endless-loop hard stop

If a role's pane shows a repeated `ready_for_next` → `NO_TASK` spin (the pane
keeps changing, so ordinary stuck-activity detection never fires), the handoff
daemon **halts the whole swarm** after three consecutive chase observations (~15s) of
that pattern — emailing the operator and running `kill_all_swarm.sh`. This is
deliberate: burning tokens on an idle loop has no upside. Fix the idle path,
then relaunch with `./swarm`.
