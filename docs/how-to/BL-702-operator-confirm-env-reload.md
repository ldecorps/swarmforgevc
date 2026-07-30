# How to use Cursor Remote confirm + env-reload (BL-702)

Slice 1 of the operator command surface. Soft and hard verbs on Cursor Remote
ask for Confirm before they mutate anything. Swarm relaunches re-read
`.swarmforge/swarm.env`.

## Confirm tiers

- **Read** (`/status`, `/update`, `/log`, `/doctor`, `/tunnel`, `/help`,
  `/confirm-off`): run immediately.
- **Soft** (`/compile`, `/pull`, `/syncenv`, `/redeploy`, …): one Confirm tap.
- **Hard** (`/restart`, `/bounce …`, `/ensure`, `/stop`, …): Confirm with an
  explicit hard warning.

`/confirm-off` or Cancel clears a pending confirm without running it.

## Env reload

`/restart`, `/start`, `/bounce swarm|extension|all`, and bridge redeploy paths
merge `.swarmforge/swarm.env` over the host environment before child spawn
(`buildLaunchEnv` / bridge start scripts). Values are never echoed by
`/syncenv` — only key presence.

## Lifecycle twins (after confirm)

- `/pause` / `/resume` — write `.swarmforge/operator/control-pause.json` (same
  marker Control uses; freezes promotion, does not kill panes).
- `/stop` — runs `swarmforge/scripts/kill_all_swarm.sh` (socket-scoped reap).
- `/start` / `/restart` — write the bounce sentinel so the owning context
  relaunches with env merge.

`/ensure` is single-flight: a second confirm while ensure is in progress is
refused until the lock clears (or goes stale after ~3 minutes).

## Wrong topic / wrong sender

Unauthorised or off-topic hard verbs are refused or ignored. No bounce
sentinel is written.
