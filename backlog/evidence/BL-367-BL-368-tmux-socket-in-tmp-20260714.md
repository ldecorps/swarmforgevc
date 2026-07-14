# INTAKE — the swarm's tmux socket lives in /tmp, where anything can silently decapitate it

Source: live incident during a human-attended session, 2026-07-14 ~02:06 UTC+1. Scope
request for the specifier. Not a pre-baked design — the fix direction below is a
starting point, not the requirement. Incident write-up (by the Operator, since deleted
once the swarm was relaunched): `.swarmforge/operator/INCIDENT-tmux-socket-unlinked.md`.

## Live evidence

The swarm launched at 01:19 on socket `/tmp/swarmforge-1000/1523266553.sock`. Some time
before 02:06 the **entire `/tmp/swarmforge-1000/` directory was deleted out from under the
running tmux server**. Observed state at 02:06:

- tmux server (pid 6634) **still alive**, still owning all 8 role panes.
- All 8 role `claude` processes **alive and working** (pids 7140–7790, burning CPU).
- Socket path gone from disk → `tmux -S <sock> ls` fails with
  `error connecting to /tmp/swarmforge-1000/1523266553.sock (No such file or directory)`.

**A unix socket cannot be re-linked once unlinked.** There is no tmux command to rebind a
running server to a new socket path. So tmux control of that swarm was *unrecoverable*: no
`capture-pane`, no nudges, no stall detection, no dead-pane respawn — permanently, for the
life of those 8 processes. The only exit was to kill the orphaned server and all 8 agents
and relaunch (which is what was done; the 5 in-flight parcels resumed cleanly via BL-323's
RESUME-ON-START, so no parcel was lost — but every agent's in-turn context was).

## Defect A — the socket lives in a directory the OS and any process may reap

`swarmforge/scripts/swarmforge.sh:57` places it in world-writable `/tmp`:

    TMUX_SOCKET_DIR="/tmp/swarmforge-${UID}"

`/tmp` is the one directory on the box that is explicitly *everybody's* scratch space and is
subject to reaping (`systemd-tmpfiles`, cleanup scripts, test harnesses, an agent tidying up,
a human running `rm -rf /tmp/*`). The swarm's single control channel — the thing the entire
Operator recovery layer depends on — has no business being there.

**What killed it this time is NOT established.** Ruled out by inspection: `systemd-tmpfiles-clean`
(policy is `D /tmp 1777 root root 30d`, and unrelated `/tmp` dirs created at 01:21 survived its
01:32 run, so the 13-minute-old socket was never age-eligible); `kill_all_swarm.sh` (audit log
shows it last ran 2026-07-10); any repo code (nothing removes that path); the BL-340 benchmark
(no socket operations, and it merged *after* the loss); and the agents themselves (no `/tmp`
deletion in any agent transcript). **Do not close this ticket by finding the culprit — the
defect is the location, not the reaper.** Even a correctly-identified one-off reaper leaves the
next one free to do it again.

### What "fixed" looks like (Defect A)
The socket belongs somewhere with an owner and a lifetime tied to the session, not to `/tmp`.
Candidates for the specifier to weigh:
- `$XDG_RUNTIME_DIR` (`/run/user/1000`) — the purpose-built location for exactly this: per-user,
  0700, cleaned on logout, never touched by `/tmp` reapers. Standard practice for tmux/ssh agents.
  Caveat to check: on WSL2 / headless / systemd-less hosts `XDG_RUNTIME_DIR` may be unset, so a
  fallback is needed (and the fallback must not be `/tmp`).
- Under the repo's own gitignored `.swarmforge/` tree — same posture the *operator* socket already
  uses (`.swarmforge/operator/operator-tmux.sock`), which **survived this incident untouched**.
  That asymmetry is itself the argument: the operator's socket was safe precisely because it was
  not in `/tmp`.

## Defect B — the swarm cannot tell "control channel lost" from "all 8 agents died"

When the socket vanished, the runtime's health sweep read `agents_running: 0` and enqueued **8
false `AGENT_EXITED` events**. That is the single most dangerous signal in the system: the
scripted recovery for it is to relaunch the roles, and relaunching here would have spawned a
**second set of 8 agents onto the same worktrees** as 8 still-running ones → concurrent commits,
racing merges, duplicated work.

We got lucky: the disposable Operator that picked up those events reasoned its way to the truth
(tmux server alive + role pids alive + handoffd heartbeat fresh ⇒ agents are fine, the *socket* is
gone), wrote the incident file, and refused to relaunch. **That correctness came from an LLM's
judgment, not from a guardrail.** It should not be load-bearing.

### What "fixed" looks like (Defect B)
`agents_running: 0` must be *unreachable* by socket loss alone. Directions to weigh:
- Distinguish the two states before emitting `AGENT_EXITED` at all: a role's liveness is knowable
  without tmux (role pid alive? worktree committing? handoffd heartbeat fresh?). Socket-unreachable
  should raise a distinct, loud `SWARM_CONTROL_LOST` — never N× `AGENT_EXITED`.
- Any relaunch path (`start-swarm.sh`, `./swarm`, `role_lifecycle.sh unpark`) should refuse to start
  a role whose previous `claude` process is *still alive*, regardless of what tmux says. A pid check
  is cheap and would have made the dangerous action impossible rather than merely un-taken.

## Note for the specifier
These are two tickets, not one, and B is the more serious of the pair: A is a fragile location that
bit us once; B is a mechanism that, on the same input, would have corrupted the repo. B is worth
fixing even if A moves the socket somewhere safe, because socket loss is not the only way the
control channel can go away.
