# INTAKE — Pipeline board: one unified grid across swarm1 + swarm2 (s1 / s2)

**Date:** 2026-08-21  
**Urgency:** normal  
**Surface:** Telegram pipeline board (concierge / `pipelineBoard.ts` + sync)  
**Human naming:** Operator says **swarm1 / swarm2** (short **s1 / s2**). Wire names today remain `swarm_name primary` (s1, Mac) and `swarm_name second` (s2, WSL2 at `/home/carillon/code/swarmforgevc`, pack `second-swarm`). Badges may show `s1`/`s2` if clearer than `primary`/`second`.  
**Context:** s2 brought up on WSL2. Operator wants **one** kanban grid showing tickets from both swarms, not two separate boards.

## Ask

Extend the pipeline board so a **single grid** lists active / parked / relevant tickets across **both s1 and s2**, with a clear per-cell (or per-row) **swarm badge** (`s1` / `s2`, or `primary` / `second` mapped 1:1).

Prefer this over “two grids on one topic.”

## Current gap

- Pipeline board render/sync is **mono-swarm**: it reflects the backlog + live stage view of the swarm running the front-desk concierge (typically s1).
- Tickets already coordinate via shared git backlog and optional `swarm:` field (BL-090), but the board does not merge cross-swarm membership into one grid.
- Fleet console (`~/.swarmforge/fleet/<name>/status.json`, BL-246/437) is a **health rollup**, not a pipeline kanban.
- s2 bring-up today often skips front-desk (no `fleet/second/telegram.json`) — unified board should still work from the **s1** board topic without requiring a second Telegram poller.

## Desired behavior

1. **One grid** on the existing pipeline board topic (s1 front-desk).
2. Include tickets that belong to s1 **and** tickets assigned to s2 (`swarm: second`) (and, if cheap, any other live fleet swarm_name later — start with s1+s2).
3. Each ticket cell/row shows which swarm owns it (badge or short prefix — prefer **s1** / **s2**).
4. **Stage column** should be correct for both:
   - Prefer shared backlog / ticket YAML / folder stage when that is authoritative.
   - Where live “held by role X” comes from pane state, merge s1 local state with an s2 signal (s2 checkout state and/or `~/.swarmforge/fleet/second/status.json` / published rollup) — do not invent a second Telegram bot for this.
5. Sorting / LINKS / parked / recently-closed behavior should remain coherent (alphabetical / most-recent rules already in BL-513 etc. still apply to the unified set).

## Non-goals

- Do not require a second pipeline board topic or second front-desk bot for v1.
- Do not replace the fleet console; this is the kanban board, not status.json merge.
- Do not change secondary mode authority (s2 still does not promote/assign).

## Ops note (related, optional follow-up)

s2’s `fleet-status-sweep` currently errors: missing `extension/out/tools/emit-fleet-status.js` in `/home/carillon/code/swarmforgevc` (needs `npm run compile` there). Useful if live stage merge reads fleet publish — not a substitute for this board intake. See sibling `INTAKE-s2-advertise-fleet-and-s1-coordinator.md`.

## Acceptance hints

- With s1 board live and s2 running, tickets with `swarm: second` appear on the **same** grid as s1 tickets.
- Swarm ownership is visible per ticket without opening YAML (s1/s2 badges OK).
- Board still posts/pins as today (single message / pin discipline unchanged).
- Unit or acceptance coverage for “two swarm names → one rendered grid with badges.”
- No 409 / second getUpdates poller introduced by this work.

## Suggested implementation sketch

- `pipelineBoard.ts` data model: optional `swarm` on row/entry; render badge in cell (display map primary→s1, second→s2 if desired).
- Concierge tick / board data gather: union tickets from shared backlog folders; resolve stage via existing s1 path + s2 checkout or fleet status when `swarm:` ≠ local.
- Docs: short note in pipeline-board / BL-091 how-to that the board is fleet-aware (unified grid); human shorthand s1/s2.
