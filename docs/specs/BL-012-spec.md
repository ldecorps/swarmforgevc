# BL-012 Spec: Chase and Dead-Letter Escalation

## Goal

Messages that go unacknowledged too long get chased; messages chased too many
times get escalated to dead-letter with a visible warning on the receiver's
tile.  The chase monitor is heartbeat-gated: it respawns a dead receiver before
chasing, so nudges go to a live agent.

---

## Configuration keys

| Key | Default | Meaning |
|-----|---------|---------|
| `swarmforge.comms.chaseTimeoutSeconds` | `90` | Time in `created` before first chase |
| `swarmforge.comms.maxChases` | `3` | Chases before dead-letter |
| `swarmforge.comms.stuckReceivedTimeoutSeconds` | `180` | Time in `received` before amber flag (2× chaseTimeout) |
| `swarmforge.comms.archiveOnRunStart` | `true` | Move old logs to `archive/` at run start |

---

## Message lifecycle (extended from BL-009)

```
created ──► received ──► done
    │
    │ age > chaseTimeoutSeconds (and receiver alive)
    ▼
chased (chase_count: 1)
    │
    │ still no received, age > chaseTimeoutSeconds again
    ▼
chased (chase_count: 2)  ...up to maxChases
    │
    │ chase_count == maxChases and still no received
    ▼
dead-letter  (terminal — no further events)
```

### `chased` event format

```yaml
{event: chased, chase_count: 1, chased_by: watchdog, at: "2026-06-29T21:41:30Z"}
```

### `dead-letter` event format

```yaml
{event: dead-letter, chase_count: 3, at: "2026-06-29T21:44:30Z"}
```

Both events are appended using the same lock/write/rename protocol as BL-009.

---

## Heartbeat-gated chase logic

Before each chase attempt, check the receiver's watchdog state:

```
if receiver.liveness == 'dead' or receiver.liveness == 'unknown':
    trigger respawnAgent(receiver)
    // do NOT write a chased event yet
    // auto-pickup (BL-013) will process the pending message on relaunch
    return
if receiver.liveness == 'stuck':
    // do not chase — receiver is alive but blocked on a tool
    // wait until stuck clears or deadTimeout triggers respawn
    return
// receiver is 'alive' or 'idle' — safe to chase
appendChasedEvent(message)
sendNudge(receiver, message.id)
```

**Chasing a dead receiver is always wrong** — the nudge goes nowhere and the
chase count increments pointlessly.

---

## Nudge on chase

Write a new message via the message bus:

```ts
messageBus.send('watchdog', receiver, 'chase-nudge',
  `Message ${messageId} (${subject}) has been waiting ${ageSeconds}s. Please acknowledge.`);
```

Also send a tmux `send-keys` to the receiver's pane (same text, truncated to
80 chars).

---

## Stuck-received flag

A message in `received` state longer than `stuckReceivedTimeoutSeconds`:
- Tile shows amber badge on the receiver: `1 received (stuck)`.
- No chase event is written — it is already acknowledged; only a tile flag.
- If the receiver then goes `dead`, watchdog respawns it and the stale lease
  becomes claimable (BL-009 lease staleness rule applies).

---

## Dead-letter display

When a `dead-letter` event is appended:
- Receiver tile border turns **red**.
- Tile label: `dead-letter: "<subject>"`.
- Message panel entry is highlighted red.
- A VS Code warning notification is shown:
  `SwarmForge: message "<subject>" to <role> reached dead-letter after 3 chases.`

Human must intervene.  No further automatic action.

---

## Messages panel tab

A "Messages" tab in the SwarmForge panel (separate from the agent tiles) lists
all messages in `.swarmforge/messages/*.log` (excluding `archive/`).

Columns: `ID · From · To · Subject · Status · Age · Chases`

Sorting: most recently active first.

Color coding:
- `done` → muted grey
- `received` → normal
- `created` (not yet chased) → normal
- `chased` → amber
- `dead-letter` → red
- `received` stuck past `stuckReceivedTimeoutSeconds` → amber

Tile badge (per agent tile): `N sent · M received`
- "sent" = messages addressed to this role in `created` or `chased` state.
- "received" = messages addressed to this role in `received` state.

---

## Run-start archival

On each **explicit new swarm launch** (operator runs **Launch Swarm** / `./swarm`
when no live swarm exists — *not* on extension reload/reattach):

1. Move all `.log` files from `.swarmforge/messages/` to
   `.swarmforge/messages/archive/<run-id>/`.
2. The in-memory handled-IDs set is cleared (new run, fresh slate).
3. Messages in `received` with stale leases are NOT auto-completed —
   they remain in the archive for audit.

This keeps the live messages directory small and ensures the panel only shows
messages from the current run. Extension reattach to a live tmux swarm does
**not** trigger run-start archival and does **not** restart agent processes.
See `docs/specs/headless-reattach-doctrine.md`.

---

## Acceptance criteria

- [ ] Write a message; do not ack it; after `chaseTimeoutSeconds` confirm a
      `chased` event is appended and the receiver gets a nudge message.
- [ ] After 3 chases without an ack, confirm `dead-letter` event is appended
      and the tile turns red with label `dead-letter: "<subject>"`.
- [ ] Heartbeat-gated: receiver in `dead` state → respawn is triggered, no
      `chased` event written, chase count stays at 0.
- [ ] Heartbeat-gated: receiver in `stuck` state → no chase, no nudge.
- [ ] A message acked during the chase window: `chased` events stop; no
      dead-letter.
- [ ] A `received` message past `stuckReceivedTimeoutSeconds` → tile badge
      shows `1 received (stuck)`, no chase event.
- [ ] Messages panel tab shows all current-run messages with correct status
      colors and chase counts.
- [ ] Tile badge `N sent · M received` is accurate.
- [ ] Run-start archival moves all logs to `archive/<run-id>/` and clears the
      handled-IDs set.
- [ ] Dead-letter produces a VS Code warning notification.

## Out of scope

- Respawn implementation belongs to BL-013.  This slice calls
  `respawnAgent(role)` which may be a stub.
- Message bus write mechanics (lock protocol) belong to BL-009.
- Heartbeat read mechanics belong to BL-010/011.
