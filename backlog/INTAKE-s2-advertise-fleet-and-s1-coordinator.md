# INTAKE — Advertise swarm2 (s2) to fleet + swarm1 (s1) coordinator

**Date:** 2026-08-21  
**Urgency:** normal  
**Surface:** fleet status (BL-437), emit-fleet-status, second-swarm bring-up, coordinator awareness  
**Human naming:** Operator says **swarm1 / swarm2** (short **s1 / s2**).  
- **s1** = Mac primary coordinator swarm — wire `swarm_name primary`  
- **s2** = WSL2 secondary — wire `swarm_name second`, checkout `/home/carillon/code/swarmforgevc`, pack `second-swarm`, RC names already `SwarmForge-Second-*`  

**Context:** s2 is up on WSL2. Operator asked how to advertise `swarm_name` to the s1 coordinator. Diagnosis: no LLM discovery path today; fleet publish on the WSL host is broken and would mis-name even if fixed; fleet files are host-local so WSL cannot reach Mac via `~/.swarmforge/fleet/` alone.

Related
- BL-090 / BL-091 — identity + `swarm:` assignment; WSL2 second bring-up
- BL-437 / BL-246 — fleet status publish + fleet console
- Sibling: `INTAKE-pipeline-board-unified-s1-s2-grid.md`

## Ask

Make a live s2 reliably advertise its `swarm_name` (and basic health) so:

1. **Same-host operator tooling** sees s2 under `~/.swarmforge/fleet/second/` (fleet console; display may say s2).
2. **s1 coordinator** (often on another host) has a clear, durable way to know that capacity named s2 / `second` exists — at least enough to assign `swarm: second` when routing work — without the human re-explaining every shift.

## Current gap

### Work routing (exists, not presence)
- s1 advertises work *to* s2 via git ticket field `swarm: second` (BL-090). That is the intended enslavement path.
- That does **not** advertise that s2 is *up*.

### Fleet publish (broken on live s2 checkout)
- handoffd `fleet-status-sweep!` shells `node extension/out/tools/emit-fleet-status.js <repo>`.
- On `/home/carillon/code/swarmforgevc`, `extension/out/` is missing → repeated `fleet-status-sweep-error` / module not found in `handoffd.log`.
- Even after `npm run compile`, `emit-fleet-status` / `readSwarmName` reads **`swarmforge.conf` only** and defaults to `"primary"`. Pack-launched identity lives in `.swarmforge/swarm-identity` (`swarm_name second`). Emit would publish as `primary` and **clobber** `~/.swarmforge/fleet/primary/status.json`.

### Cross-host (WSL s2 ↔ Mac s1)
- Fleet rendezvous is **local** `~/.swarmforge/fleet/` (or `SWARMFORGE_FLEET_DIR`). A WSL publish does not appear on the Mac s1 host.
- s1 coordinator.prompt does **not** read fleet status.json as a live roster.
- Claude Remote Control names for s2 are already distinct (`SwarmForge-Second-*` in `second-swarm.conf`) — that is human/phone visibility of panes, not coordinator capacity discovery.

## Desired behavior

1. **Emit naming:** `emit-fleet-status` (and any sibling TS readers of swarm name) resolve `swarm_name` the same way Babashka / Telegram fleet creds do: prefer `.swarmforge/swarm-identity`, then conf, then default `primary`.
2. **Bring-up:** BL-091 / second-swarm docs (or ensure) require compiling `extension/out` on the s2 checkout so handoffd’s fleet sweep can succeed — or ship a non-extension publisher if compile is too heavy for secondaries.
3. **Same-host proof:** with s2 up, `~/.swarmforge/fleet/second/status.json` updates on a handoffd cycle; `fleet-console` lists s2 / `second` without colliding with s1 / `primary`.
4. **s1 coordinator awareness (v1 ok to be thin):** pick one durable channel Mac s1 can actually see, e.g.:
   - a short standing note / briefing / STEERING blurb that s2 is an assignable capacity when healthy; and/or
   - a git- or Telegram-visible “fleet roster” snippet the coordinator is instructed to read before promote; and/or
   - (stretch) coordinator prompt + tool to read a synced roster if/when cross-host sync exists.
5. Do **not** invent a second primary coordinator. s2 remains secondary (`swarm_mode secondary`).

## Non-goals

- Auto-registering s2 as a peer coordinator.
- Requiring a second Telegram front-desk / getUpdates poller for presence.
- Replacing `swarm:` ticket assignment (still the work-routing mechanism; value remains `second` unless a rename ticket changes wire names to `s1`/`s2`).

## Ops evidence (WSL host, 2026-08-21)

- Identity: `/home/carillon/code/swarmforgevc/.swarmforge/swarm-identity` → `swarm_name second` (s2).
- `~/.swarmforge/fleet/second/` absent; handoffd log shows missing `emit-fleet-status.js`.
- Live RC names: `SwarmForge-Second-{Specifier,Coder,…}` (pack already namespaces RC; `-n` display titles still say `SwarmForge Specifier` etc.).

## Acceptance hints

- Compile + identity-aware emit → `fleet/second/status.json` appears and updates; s1’s status file not overwritten.
- Bring-up doc or ensure step covers extension compile (or equivalent) for s2 checkout.
- Specifier/coordinator guidance documents how s1 learns s2 exists across hosts (even if v1 is STEERING / note, not live probe); use human terms s1/s2 alongside wire names.
- Tests: emit reads swarm-identity when conf lacks `swarm_name`; no clobber of `primary` when publishing from an s2 tree.

## Suggested slices

1. Fix emit name source + s2 checkout compile/docs (unblocks same-host fleet).
2. Separate ticket if needed: cross-host roster / s1 coordinator prompt read path for live s2 capacity.
