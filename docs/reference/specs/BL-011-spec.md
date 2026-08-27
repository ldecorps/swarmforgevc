# BL-011 Spec: Watchdog

## Goal

The extension host polls heartbeat files and drives tile liveness states.
Stalled or crashed agents show visible amber/red states; the watchdog nudges
idle agents and optionally respawns dead ones.

---

## Configuration keys

| Key | Default | Meaning |
|-----|---------|---------|
| `swarmforge.heartbeat.intervalSeconds` | `15` | Poll cadence |
| `swarmforge.watchdog.staleTimeoutSeconds` | `60` | Idle threshold (amber) |
| `swarmforge.watchdog.inFlightTimeoutSeconds` | `600` | Stuck-tool threshold (red) |
| `swarmforge.watchdog.deadTimeoutSeconds` | `180` | No-response threshold (red) |
| `swarmforge.watchdog.autoRespawn` | `false` | Auto-respawn dead agents |
| `swarmforge.watchdog.maxRespawnsPerRole` | `3` | Respawn cap per sliding window |
| `swarmforge.watchdog.respawnWindowSeconds` | `600` | Sliding window for cap |

---

## Liveness state machine (per role)

```
         alive (green)
           │
           │ last_beat age > staleTimeoutSeconds
           │ AND in_flight: false
           ▼
         idle (amber)  ─── nudge sent to agent inbox
           │
           │ still stale after deadTimeoutSeconds
           │ OR kill -0 <pid> fails
           ▼
         dead (red)  ─── auto-respawn if enabled and under cap
           │
           │ PID alive, in_flight: true, age > inFlightTimeoutSeconds
           ├──────────────────────────────────────────────────────────────────►
           │                                                          stuck (red)
           │                                           tile shows: "stuck: <tool_name>"
           │
           │ Heartbeat file absent entirely
           ▼
         unknown (grey) ─── shown until first heartbeat arrives
```

Transitions are one-way within a poll cycle; each poll re-evaluates from the
current file state (a recovered agent goes back to `alive` immediately).

---

## Nudge mechanism

When a role transitions to **idle (amber)**, the watchdog writes a nudge using
the message bus (BL-009):

```ts
messageBus.send('watchdog', role, 'nudge', 'You appear idle. Run ready_for_next.sh.');
```

This creates a `.swarmforge/messages/<id>.log` file.  The watchdog also sends a
tmux `send-keys` to the role's pane with the text:

```
You have a nudge in your message inbox. Run ready_for_next.sh if idle.
```

One nudge per transition to idle — do not spam on every poll cycle.  Track
`lastNudgedAt` per role; suppress further nudges until the role recovers to
`alive` first, then goes idle again.

---

## Respawn cap (sliding window)

```ts
respawnHistory: Map<Role, number[]>   // timestamps of recent respawns

function canRespawn(role: Role): boolean {
  const now = Date.now() / 1000;
  const window = config.respawnWindowSeconds;
  const recent = (respawnHistory.get(role) ?? []).filter(t => now - t < window);
  return recent.length < config.maxRespawnsPerRole;
}
```

When cap is exceeded, tile stays **red** with label "respawn limit reached —
human intervention required".  No further auto-respawn attempts.

---

## Tile visual states

| State | Tile border | Label |
|-------|------------|-------|
| alive | green | — |
| idle | amber | "idle" |
| stuck | red | "stuck: `<last_tool>`" |
| dead | red | "not responding" |
| cap exceeded | red | "respawn limit reached" |
| unknown | grey | "waiting for heartbeat" |

---

## Status bar aggregate

Format: `SwarmForge: N agents · A alive · I idle · D dead`

Omit zero-count categories:  
- All alive → `SwarmForge: 4 agents · 4 alive`  
- Mixed → `SwarmForge: 4 agents · 2 alive · 1 idle · 1 dead`

---

## Watchdog lifecycle

- Starts when a swarm run begins (after `swarmforge.run`).
- Stops when the run stops.
- Each poll reads all files in `.swarmforge/heartbeats/` matching `*.yaml`.
  Roles present in `swarmforge.conf` but missing a heartbeat file → `unknown`.
- Stale `.lock` files in `.swarmforge/messages/` older than 5 s are deleted
  during each poll pass (housekeeping responsibility shared with watchdog).

---

## Acceptance criteria

- [ ] Write a heartbeat file for a role; confirm tile shows `alive`.
- [ ] Stop updating the heartbeat (simulate stall); after `staleTimeoutSeconds`
      confirm tile shows `idle` and a nudge message appears in
      `.swarmforge/messages/`.
- [ ] After `deadTimeoutSeconds` (without recovery), confirm tile shows `dead`.
- [ ] Kill the simulated process PID; confirm tile shows `dead` immediately
      regardless of `deadTimeoutSeconds`.
- [ ] Write a heartbeat with `in_flight: true` and stop updating; after
      `inFlightTimeoutSeconds` confirm tile shows `stuck: <tool_name>`.
- [ ] BUT: `in_flight: true` + PID gone → classified as `dead`, not `stuck`.
- [ ] Recover the agent (resume heartbeats); confirm tile returns to `alive`.
- [ ] Trigger respawn 3 times within the window; confirm 4th auto-respawn is
      suppressed and tile shows "respawn limit reached".
- [ ] Status bar aggregate updates correctly after each state change.
- [ ] Stale `.lock` files older than 5 s are removed during a poll pass.
- [ ] No nudge is sent twice for the same idle transition.

## Out of scope

- Chase logic for unacknowledged messages belongs to BL-012.
- Respawn implementation details belong to BL-013 (per-agent respawn).
  This slice only calls `respawnAgent(role)` — the function can be a stub
  that logs "would respawn" until BL-013 is implemented.
