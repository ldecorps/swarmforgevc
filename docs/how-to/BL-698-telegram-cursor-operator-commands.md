# BL-698 — Telegram Cursor Remote operator commands

Phone-first ops on the Cursor Remote topic. Principal-only. Wrong topic or unauthorised sender never mutates swarm state.

Full command map: [BL-698 reference spec](../reference/specs/BL-698-telegram-cursor-operator-command-surface.md).
Confirm + env-reload note: [BL-702 how-to](BL-702-operator-confirm-env-reload.md).

## Danger tiers

| Tier | Gate | Examples |
|------|------|----------|
| Read | none | `/status` `/doctor` `/autopilot dry` `/land dry` `/shift status` `/holiday list` |
| Soft | one Confirm tap | `/compile` `/pull` `/syncenv` `/redeploy` `/shift start` `/holiday add` `/hold` `/reinstate` |
| Hard | two-step confirm | `/restart` `/bounce` `/hydrate` `/mint` `/autopilot` `/land` `/ensure` `/stop` `/kill-all` `/drain-agents` `/drain-swarm` `/ambulance` |

`/confirm-off` clears a pending confirm.

## Batch pilot verbs (BL-703)

- `/pilot BL-xxx` — Cursor wears all hats offline for one ticket. Refuses while swarm is live; offers **Stop & run** (drain-stop, wait until clear, then pilot).
- `/autopilot` / `/autopilot dry` — queue already-specced high/critical or `type: defect` tickets; pilot sequentially via a durable batch lock.
- `/land` / `/land dry` — pilot in-flight (`backlog/active/` or parcel-holding) tickets clear; then ask drain-stop each time.
- `/hydrate` / `/mint` — specifier-only wake; refuse if a full-pack role is up (before confirm); stop on handoff to coder (prompt contract).

Concurrent `/pilot` `/expedite` `/autopilot` `/land` `/hydrate` are refused while a batch is in flight.

## Shifts & holidays (BL-704)

```
/shift status|start [name] [until]|end
/holiday add YYYY-MM-DD [YYYY-MM-DD] [reason]
/holiday list
/holiday clear YYYY-MM-DD
/oncall me|off
```

Holiday quiet refuses `/pilot` `/expedite` `/autopilot` `/land` `/hydrate` `/mint` with a **Run anyway** button.

`/oncall me` records the alert target under `.swarmforge/operator/`; `/ensure` replies name that target.

Durable state lives only under `.swarmforge/operator/` (gitignored).

## Env reload

`/restart`, `/bounce`, and `/redeploy` re-merge `.swarmforge/swarm.env` into child launch env. `/syncenv` reports key presence only (never values).

## Lifecycle leftovers (BL-698 close-out)

Hard confirm on Cursor Remote (two-step), then:

- `/stop` — stop-mode menu: **Drain-stop** (wait for empty pipeline, then kill) or **Emergency-stop** (kill now)
- `/kill-all` — hard kill via `kill_all_swarm`
- `/drain-swarm` — wait until parcels clear; **no kill**
- `/drain-agents` — kill role tmux sessions only; daemons stay up
- `/ambulance BL-xxx` / `/ambulance off` — exclusive-ticket hold (same marker as Control)
- `/hold BL-xxx` / `/reinstate BL-xxx` — park to `backlog/hold/` and restore to `paused/`

Control topic aliases the same slash forms (plus bare `ambulance …`). `/kill-all` on Control maps to emergency stop.

## Diagrams

- [Cursor Remote flow](../diagrams/cursor-remote-flow.mmd)
- [Operator command surface](../diagrams/operator-command-surface.mmd)

## Related

- [Let's Talk Mini App how-to](BL-696-miniapp-lets-talk-cursor-audio.md)
- [BL-696 Telegram operator amendment](../reference/specs/BL-696-amendment-telegram-operator-commands.md)
