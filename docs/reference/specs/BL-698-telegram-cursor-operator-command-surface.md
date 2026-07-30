# BL-698 — Telegram / Cursor Remote operator command surface

**Date:** 2026-07-28  
**Status:** clarified (operator polls 2026-07-29); sliced into BL-702 / BL-703 / BL-704  
**Parent epic:** swarmforge-console (BL-517)  
**Primary ingress:** Cursor Remote Telegram topic (principal-only, topic-bound)  
**Alignment:** CLI and Control topic must share the same verb vocabulary and confirm semantics; Cursor Remote is the phone-first surface.

## Clarifications pinned (Cursor Remote polls, 2026-07-29)

| # | Topic | Decision |
|---|-------|----------|
| Q1 | Soft verbs (“optional ack”) | **Light confirm** — one Confirm tap, then run (not fire-and-report) |
| Q2 | Holiday override | **Refuse** citing holiday quiet, with a **Run anyway** button (not slash `/override` alone) |
| Q3 | After `/land` clears the pipe | **Ask each time** whether to drain-stop / sleep (no fixed default without asking) |
| Q4 | `/autopilot` selection | Every already-specced ticket with `type: defect` (plus high/critical severity as already pinned) |
| Q5 | Delivery shape | **Three child tickets:** BL-702 parse+env-reload+danger tiers → BL-703 hydrate/mint/autopilot/land → BL-704 shifts/holidays+docs |

## Goals

1. One shared **semantic + syntax** for operator verbs (parse once; execute through one backend).
2. Expand Cursor Remote from prompt/`/pilot`/`/expedite`/`/redeploy` into a full ops console.
3. **`/bounce` and `/restart` (and `/start`) re-read `.swarmforge/swarm.env`** before relaunch — same contract the cursor-bridge supervisor already uses.
4. Operator control of **shifts and holidays** from Telegram.
5. Documenter ships a how-to plus Mermaid diagrams of the Cursor Remote flow.

## Non-goals

- Replacing role-topic free-text steering (BL-566) with slash verbs for every steer.
- Building a second Mini App console page (that remains BL-517 later slices).
- Duplicating BL-660's conf-selectable 3×8 *schedule packs* — this ticket's shift/holiday surface is the **operator policy overlay** (who is on, quiet days); when BL-660 lands, both read the same shift name where applicable.

## Danger tiers (confirm UX)

| Tier | Verbs | Gate |
|------|-------|------|
| Read | `/status` `/update` `/log` `/doctor` `/tunnel` `/help` `/shift status` `/holiday list` | none |
| Soft | `/pause` `/resume` `/hold` `/reinstate` `/syncenv` `/compile` `/pull` `/quiet` | **light confirm** (one Confirm tap; Q1 pin) |
| Hard | `/stop` `/start` `/restart` `/bounce` `/drain-agents` `/drain-swarm` `/ensure` `/ambulance` `/kill-all` `/hydrate` `/mint` `/autopilot` `/land` | two-step confirm |

Unauthorised sender or wrong topic → ignore/refuse with no side effect (same bar as BL-423 / BL-696).

## Command map (Cursor Remote)

### Already on Cursor Remote (keep; fold into shared parse)

| Command | Behavior |
|---------|----------|
| plain text / photo | prompt Cursor agent |
| `/new` | fresh agent session |
| `/status` `/help` `/update` | status / help / snapshot |
| `/pilot [BL-xxx]` | Cursor-staffed offline expedition (one ticket) |
| `/autopilot` | **Batch Cursor pilot:** queue every already-specced high-priority ticket and defect; Cursor agent pilots them in priority order (same hats as `/pilot`); refuse while `/pilot` `/expedite` `/land` or another `/autopilot` is in flight |
| `/autopilot dry` | List the high-priority/defect queue only — no expedition starts |
| `/land` | **Pilot the pipe clear:** Cursor agent pilots every **in-flight** ticket to completion (same hats as `/pilot`), sequential by pipeline urgency; outcome matches “empty the live pipe” like `/drain-swarm`, but by **finishing** work instead of stopping mid-stage |
| `/land dry` | List in-flight tickets only — no expedition starts |
| `/expedite` `/reexpedite` `[BL-xxx]` | automated expedite lane |
| `/hydrate [INTAKE\|BL-xxx]` | **Specifier-only wake:** start the sleeping swarm with only the specifier; drain/spec the intake (or finish an underspecced ticket); **auto drain-stop as soon as the specifier hands off to coder** — coder does not start |
| `/mint [INTAKE\|slug]` | Alias of `/hydrate` with intake-first wording (“mint a BL from this intake”); same lifecycle and stop-on-coder-handoff contract |
| `/redeploy` | compile + restart supervised cursor bridge (**must reload swarm.env**) |
| `/log [expedite\|redeploy\|bridge\|…]` | tail operator logs |

### Prep-pass ladder (pin)

| Verb | Who works | Stops when |
|------|-----------|------------|
| `/hydrate` / `/mint` | specifier only (+ daemons handoff needs) | `git_handoff` → coder fires |
| `/pilot` | Cursor wears pipeline hats (one BL) | that ticket done / human stops |
| `/autopilot` | Cursor wears pipeline hats (high/defect queue) | queue empty / human stops / hard failure |
| `/land` | Cursor wears pipeline hats (in-flight set) | active pipe empty / human stops / hard failure |
| `/expedite` | automated expeditor | ticket done |
| `/drain-swarm` | nobody codes — wait for empty parcels | pipeline empty (or timeout → force) |
| `/start` | whole pack | until `/stop` |

### `/autopilot` selection (pin)

Live under `backlog/paused/` or `backlog/active/` (not `hold/`, not `done/`), **already specced** (`human_approval` is not `pending`; `acceptance` path present), and either:

- `severity` is `high` or `critical`, or
- `type` is `defect`

Ordered by `priority` ascending (lower = sooner), then ticket id. Epics (`type: epic`) are never selected. Each item runs the same Cursor-staffed expedition contract as `/pilot BL-xxx`, sequentially; progress posts name the current BL and remaining queue depth.

### Swarm-up fail-early gate (pin)

Cursor-as-expeditor verbs assume a **stopped** swarm (BL-567 isolation: no live
roles racing mailboxes). Detect liveness the same way the automated expeditor
does (swarm tmux session / role panes / handoffd) — not “Cursor bridge busy.”

| Verb | If swarm is up |
|------|----------------|
| `/pilot` `/autopilot` `/land` | **Refuse** immediately; reply names what is live and how to clear it (`/stop`, `/drain-swarm`). Optional hard-confirm affordance: **Stop & run** (one confirm = drain-stop then start the verb). Never silently stop. |
| `/hydrate` `/mint` | **Refuse** if any full-pack pipeline role is up; expected start state is stopped (these verbs bring up specifier only). |
| `/expedite` `/reexpedite` | Keep existing clean-slate refuse (already aligned). |

`/land` while the swarm is up is forbidden without an explicit stop: Cursor and the live pack must not both drive the same in-flight set.

### `/land` selection (pin)

**In-flight** means a non-epic ticket under `backlog/active/`, or any live ticket that currently owns a parcel in a role mailbox / `in_process` (same notion `/update` uses for “Swarm: working”). Not `paused/`, not `hold/`, not `done/`.

Ordered by stage urgency (furthest downstream first — closest to done lands first — then `priority` ascending). Each item is a sequential `/pilot`-equivalent until the ticket is in `backlog/done/` or the human aborts. After the set is clear, **ask each time** whether to drain-stop / sleep (Q3 pin) — do not silently default to land-then-sleep.

`/land` vs `/drain-swarm`: drain waits/stops without Cursor finishing tickets; land **pilots them out** then sleeps. `/land` vs `/autopilot`: autopilot pulls high/defect from paused+active; land only clears what is already in flight.

### Lifecycle / repair (add)

| Command | Behavior |
|---------|----------|
| `/pull` | `git pull --ff-only` (refuse dirty / non-ff); report SHA |
| `/compile` | extension compile only; no process restart |
| `/syncenv` | re-parse `swarm.env`; report key *presence* (never values) |
| `/start` | start swarm (or scoped service); **reload swarm.env** |
| `/stop` | confirm → drain-stop or emergency-stop |
| `/restart` | confirm → bounce swarm; **reload swarm.env** on relaunch |
| `/bounce [swarm\|extension\|bridge\|all]` | scoped bounce; **reload swarm.env**; default `swarm` |
| `/drain-agents` | graceful role drain; daemons stay up |
| `/drain-swarm` | wait until pipeline empty (parcels drained) |
| `/kill-all` | hard kill (`kill_all_swarm`); confirm; distinct from drain |
| `/ensure` | confirm → `./swarm ensure` (single-flight; same bar as BL-516) |
| `/pause` `/resume` | intake freeze / unfreeze (BL-423 semantics) |
| `/doctor` | one-shot: tmux, handoffd, bridge, tunnel, env keys, dirty git |
| `/tunnel` | tunnel URL/state |

### Ticket / backlog

| Command | Behavior |
|---------|----------|
| `/ambulance BL-xxx` | engage exclusive-ticket hold (slash form of BL-655) |
| `/ambulance off` | release |
| `/hold BL-xxx` | park ticket to `backlog/hold/` |
| `/reinstate BL-xxx` | move out of `backlog/hold/` back to paused (or prior live folder policy) |

### Quiet / mode

| Command | Behavior |
|---------|----------|
| `/quiet on\|off\|until HH:MM` | suppress chase/nudge/briefing noise |
| `/mode observe\|normal` | no new dispatch vs full swarm |
| `/lock` `/unlock` | human-has-the-wheel (stronger than pause; destructive verbs need unlock or double-confirm) |
| `/confirm-off` | cancel pending hard-tier confirm |

### Shifts & holidays (new)

```
/shift status
/shift start [name] [until]
/shift end
/holiday add YYYY-MM-DD [YYYY-MM-DD] [reason]
/holiday list
/holiday clear YYYY-MM-DD
/oncall me|off
```

**Semantics (pin):**

- **holiday** → auto-quiet + refuse `/expedite` `/pilot` `/autopilot` `/land` `/hydrate` `/mint`, with a **Run anyway** confirm button on the refuse reply (Q2 pin). `/unlock` remains available for the stronger lock overlay.
- **shift** → who is principal for confirms; off-shift → refuse hard-tier verbs or require double-confirm.
- **oncall** → who receives ambulance / ensure / doctor alerts.
- Durable state under `.swarmforge/operator/` (gitignored runtime), not committed secrets.

## Env-reload contract (hard requirement)

Any path that starts or relaunches the swarm, extension host child, or cursor/headless bridge after a Telegram `/start`, `/restart`, `/bounce`, or `/redeploy` MUST:

1. Re-read `.swarmforge/swarm.env` (same merge rules as `bridge_supervisor_env_lib.bb`).
2. Not rely solely on a stale `process.env` snapshot from the previous host process (`buildLaunchEnv` today spreads host env without re-parsing swarm.env — that is the defect this ticket closes for swarm bounce).
3. Keep `/syncenv` as the no-restart check that the file parses and required keys are present.

## Shared backend shape

Prefer one pure decision module (extend or twin `telegramCursorBridgeCore` / `telegramControlCore`) that maps text → `ignore | refuse | prompt-confirm | execute-<verb>` plus one execution façade used by:

- Cursor Remote live bridge
- Control topic (align syntax; deprecate bare `ambulance` in favour of `/ambulance` while accepting both during transition)
- CLI wrappers where a script already exists (`ambulance_cli.bb`, `remote_bounce.sh`, `./swarm ensure`, …)

Syntax on the wire is slash-first; bare legacy Control forms may alias during one release.

## Documenter deliverables (required)

1. **How-to:** `docs/how-to/BL-698-telegram-cursor-operator-commands.md`  
   Phone-first operator guide: when to use which verb, danger tiers, confirm flow, env-reload expectation, shifts/holidays, relationship to Control topic and BL-516 `/ensure`.
2. **Diagrams (Mermaid under `docs/diagrams/`):**
   - `cursor-remote-flow.mmd` — Telegram update → parse/guards → busy gate → agent prompt vs operator verb → progress/final reply; include Let's Talk sharing the same `agentId` writer.
   - `operator-command-surface.mmd` — shared verb backend feeding Cursor Remote, Control, and CLI.
3. Cross-links from the BL-696 Let's Talk how-to and the BL-696 operator-commands amendment.

## Acceptance

`specs/features/BL-698-telegram-cursor-operator-command-surface.feature`
