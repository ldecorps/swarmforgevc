# Provider auth-error auto-respawn: healing a wedged standing role

## Background

SRE incident 2026-07-19: an `AuthenticationError` left a standing role idle
while `handoffd` stayed healthy. Liveness was never the question — the role's
process was alive, just wedged behind a credential error printed to its pane.
`agent_runtime_lib`'s `classify-provider-error` already mapped that text to
`:auth`, and `provider_compat_lib/provider-auth-error-text?` already
recognized it, but nothing observed pane scrollback for it and healed the
role.

**Auth-class observe/respawn** closes that gap. `handoffd.bb`'s chase sweep
now also runs an auth-class observer (`observe-standing-role-auth!`) over
every standing role's recent pane scrollback, alongside the existing
loop-detect observe. When a pane's scrollback matches auth-class failure
text, the role is force-respawned with the same provider-compat env
machinery `swarm_ensure.bb` already uses (`provider-respawn-env-args`) — no
new respawn path, just a new trigger for the existing one. A healthy pane
(no auth-class text) is left untouched.

## Configuration

### `auth_respawn_max_attempts`

**Location:** `swarmforge.conf` (or any pack's effective config)

**Type:** positive integer, or absent for default

**Default:** `3`

**Examples:**

```text
# Explicit cap
config auth_respawn_max_attempts 3

# Or lower for a flakier provider
config auth_respawn_max_attempts 1
```

### Resolution and degradation

A missing, malformed, zero, or negative value silently degrades to the
default (`3`). `provider-auth-observe-lib/default-config` is the single
source of truth for that literal — it is not duplicated in this doc or in
`swarmforge.conf`'s comment.

To override for a live investigation:
1. Edit `swarmforge/swarmforge.conf` (or the running pack's `.conf` file).
2. Restart the handoff daemon: `start_handoff_daemon.sh`

The resident and other panes do NOT need restarting.

## How it works

1. **Attempts are bounded per failure episode.** An episode is an unbroken
   run of auth-class observations for one role; a healthy observation ends
   the episode and resets the attempt count. Below the cap, each observation
   respawns the role and counts an attempt (invariant: respawns per episode
   are bounded across ALL observe ticks — repeated 401s never busy-loop).

2. **At the cap, the sweep goes quiet — once.** Once a role's episode
   reaches `auth_respawn_max_attempts`, further observe ticks stop
   respawning it and send exactly one operator-visible alert for that
   episode (no duplicate alerts, no further respawns) until a healthy
   observation resets it.

3. **The alert reuses the existing operator channel** — the same Telegram
   OPERATOR-topic + email path `handoffd`'s endless-loop breaker already
   uses (see `swarmforge/PIPELINE.md`, "Endless-loop hard stop") — so no new
   alert surface was introduced.

4. **This is a different failure class from the endless-loop breaker.** The
   endless-loop breaker halts the whole swarm for a repeated
   `ready_for_next` → `NO_TASK` spin. Auth-class observe/respawn targets one
   wedged role behind a credential error and heals it in place; it never
   halts the swarm.

## Observing the behavior

Watch `handoffd.log` for these tags:

- `auth-respawn <role> <launch-script>` — a role was force-respawned with
  provider-compat env after an auth-class observation.
- `auth-respawn-skip-busy <role>` — respawn was skipped because the pane
  was mid-command; the next sweep retries.
- `auth-persist-alert <role> <reason>` — the attempt cap was reached; an
  alert was recorded for this episode.
- `auth-persist-telegram <role>` / `auth-persist-email <role>` — the
  Telegram and email legs of that alert were sent (each logs
  `-error` on failure without blocking the other leg).
- `auth-observe-error <message>` — the observer itself errored; the chase
  sweep continues (this path never blocks the rest of the sweep).

## Troubleshooting

### A wedged role never respawns

1. Confirm `handoffd` is running: `pgrep handoffd`
2. Check the pane's actual scrollback text against
   `provider_compat_lib.bb`'s recognized auth-class strings — text that
   doesn't match is treated as healthy by design.
3. Check `handoffd.log` for `auth-respawn-skip-busy` — a busy pane defers
   to the next sweep rather than force-respawning mid-command.

### Alert never arrives after repeated respawns

Check `handoffd.log` for `auth-persist-telegram-error` /
`auth-persist-email-error` — a delivery failure on one channel does not
retry or block the other; fix the underlying channel (bot token, SMTP
config) and the next reached cap will alert again.

---

**Related:** `swarmforge/PIPELINE.md` ("Endless-loop hard stop") for the
sibling swarm-wide circuit breaker; `docs/how-to/BL-611-babysitterd-runbook.md`
for the separate deterministic health-sweep daemon.
