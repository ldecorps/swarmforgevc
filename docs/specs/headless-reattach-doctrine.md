# Headless swarm + extension reattach (operator doctrine)

## Principles

1. **Swarm runs headless.** Agent processes live in tmux. `SWARMFORGE_TERMINAL=none`
   is the default for extension-driven launches — no macOS Terminal surfaces.
2. **Extension is an observer and control surface.** It tails tmux panes and issues
   commands; it does not replace the swarm substrate.
3. **Extension start = reattach, not restart.** When a live swarm exists
   (`isSwarmReady()`), activation opens the panel and reconnects tile streams.
   No agent respawn, no `kill-server`, no cold launch — unless the operator runs
   **Launch Swarm** explicitly.
4. **Explicit launch only when cold.** `Launch Swarm` may tear down a *non-ready*
   stale socket (orphan metadata with no live sessions) before starting a new run.
   That is not extension startup behavior.
5. **Daemon is an extension-layer reliability feature, phased in.** Phase 1 proves
   handoff delivery with native tmux injection only. Phase 2 adds `handoffd` and the
   mailbox/outbox pipeline the extension supervises.

## What is NOT required

- Restarting agent processes on extension reload to avoid "unknown running state".
- Opening Terminal.app windows when the extension launches a swarm.
- Auto-launching a cold swarm when F5 opens the Extension Development Host.

## Reattach vs launch (decision table)

| Situation | Extension behavior |
|-----------|-------------------|
| Live tmux + `sessions.tsv` + all role sessions | Reattach panel tiles (preserveFocus) |
| No live swarm, operator did not request launch | Show empty panel or last-known state; do not spawn `./swarm` |
| Operator runs **Launch Swarm** | Spawn `./swarm` headless; wait for ready; open panel |
| Stale socket file but tmux dead | `Launch Swarm` clears stale state then cold-starts |

## Handoff phases (BL-153)

### Phase 1 — tmux injection only (`SWARMFORGE_SKIP_DAEMON=1`)

- `./swarm` starts coordinator + coder + cleaner (two-pack), `active_backlog_max_depth 1`.
- No `handoffd` or supervisor.
- `swarm_handoff.sh` enqueues to outbox **and** delivers via the same verified tmux
  `notify!` path (literal send + submit) directly to recipient panes.
- Extension chaser must not assume daemon health; transport health reads parcel files only.

### Phase 2 — daemon + mailbox (backup)

- Re-enable `handoffd` + supervisor on launch (`SWARMFORGE_SKIP_DAEMON` unset).
- **Every** `swarm_handoff.sh` still tries sync tmux inject first.
- On sync success: outbox → `sent/`; daemon sees nothing (silent backup).
- On sync failure: outbox stays queued; daemon delivers to `inbox/new/` + wake.
- See `docs/specs/handoff-dual-path.md` for pane narration rules (mail silent on
  happy path; mention mailbox only on backup-only discovery).
- Extension observes daemon status (BL-144/146); BL-128 resumes after phase 2 green.

## Minimal resilience pack

See `swarmforge/packs/resilience-min.conf`:

- Roles: **Coordinator**, **Coder**, **QA**
- `active_backlog_max_depth 1` — one active ticket at a time
- Hold all other backlog items until handoff phase 1 passes
