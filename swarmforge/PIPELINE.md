# Parcel Flow

This is the pipeline every agent follows. Each work item ("parcel") moves down a
single ordered chain of roles. Read your own `swarmforge/roles/<role>.prompt` for
the substance of your stage; this file is only the flow between stages.

## Notify chain

```
specifier ─► coder ─► cleaner ─► architect ─► hardender ─► documenter ─► QA (integrate) ─► coordinator (bookkeep)
```

The **coordinator** sits outside the forward chain (duties in full: Article
1.1, `01_roles.md`, same boot prefix). An active ticket with no `assigned_to`
is nudged to the coordinator by `handoffd`'s unassigned-active sweep (see
`swarmforge/handoff-protocol.md`); the daemon never assigns for it.

The **specifier** writes specifications only (Article 1.2) — it does not
merge, close tickets, or promote backlog items.

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

- The specifier works on **master** but only for spec/prompt files — not
  integration merges; every other role works only in its own
  `.worktrees/<role>` branch. See **pipeline-detailed.md** for the
  full pre-trim wording.

## How a parcel moves

1. The **specifier** writes the spec to `backlog/paused/` and notifies the
   **coordinator** (does not activate work itself).
2. The **coordinator** promotes an eligible item into `backlog/active/`
   (respecting `active_backlog_max_depth`) and routes it to the specifier or
   coder as appropriate for the pack.
3. Each stage works in its own worktree, commits, then sends a `git_handoff`
   (priority `00`) to the next role, preserving the stable task name.
4. Cleaner → architect (architecture review) → hardender (mutation
   hardening) → documenter (docs) → QA (final gate). See
   **pipeline-detailed.md** for steps 1-4's full pre-trim wording.
5. **QA** is the last quality gate. On pass it broadcasts a merge-up `note` to
   every worktree role, **lands the approved commit on `main`** itself
   (pushes origin, closes a `GH-`-seeded issue; BL-247), then sends the
   coordinator the approved commit + task id.
6. The **coordinator** (bookkeeping only — no git merge/push): moves the item
   `active/` → `done/`, rechecks the depth cap, and **routes** the next
   promoted item in the SAME turn (mono-router: Work note to coder /
   `promote_and_route_next.sh` / `route_backlog_to_coder.sh`) — promote
   without route strands the resident on `NO_TASK`.
7. A role must **not** forward a `git_handoff` when the received commit
   produces no functional change — it completes the inbound task instead
   (see `handoff-protocol.md`).

## Sending and receiving

- Send only via `swarm_handoff.sh <draft-file>`; never write to `inbox/new/`.
- Receive by running `ready_for_next.sh`, which dispatches to the task or batch
  helper configured for your role.
- The full draft format, message types, queue helpers, and audit rules are in
  `swarmforge/handoff-protocol.md`.


## Mono-router idle and open slots

Mono-router packs keep **one resident** process (usually **coder** as home)
that rotates other pipeline roles in on demand, with the coordinator as a
separate always-on pane. On `NO_TASK`: STOP (no re-poll/`/loop`); rotate to
**specifier** if root intakes exist; else if a slot is open and paused work
exists, send **one** `note` asking the coordinator to promote+route, then
idle for a wake — promotion stays coordinator-owned. See
**pipeline-detailed.md** for the full pre-trim wording.

### Aged-note rotation (BL-576), `rule_proposal` actionability (BL-795), and non-home stranding after QA merge-up (BL-550)

A solo `note` to a dormant role stays non-actionable until
`note_actionable_after_ms` (default 20 min) ages it in, to avoid broadcast
thrash on a five-role merge-up — a directed `rule_proposal` is different, it
is actionable immediately. A non-home role must `rotate_to_role.sh <home>`
proactively once its inbox is empty after a merge-up note, or it strands
(tool backstop: `ROTATE_HOME`, not `NO_TASK`). Full mechanics for all three:
**pipeline-detailed.md**, `swarmforge/handoff-protocol.md`,
`docs/how-to/BL-576-aged-note-actionability-mono-router.md`.


## Endless-loop hard stop

A repeated `ready_for_next` → `NO_TASK` spin (the pane keeps changing, so
ordinary stuck-activity detection never fires) makes the handoff daemon
**halt the whole swarm** after three consecutive chase observations (~15s) —
alerting on Telegram and email, then `kill_all_swarm.sh`. Deliberate: burning
tokens on an idle loop has no upside. Fix the idle path, then `./swarm`.


## Same gates, no machinery: the expeditor (BL-567)

When the defect is IN the swarm's own delivery machinery, the fix cannot ride
the pipeline it is repairing. `swarmforge/scripts/expedite.sh <BL-id>` walks
ONE ticket through the same role hats and gates with the stack stopped,
reading only durable git data. It parks active work to `backlog/hold/` first
(never `paused/`) and a failed restart never retracts a QA-stamped verdict.
Full mechanics: **pipeline-detailed.md**,
`docs/how-to/BL-567-expedite-one-ticket-with-the-swarm-stopped.md`,
`docs/explanation/BL-567-why-the-expeditor-commands-the-stack-but-never-depends-on-it.md`.
