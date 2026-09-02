# Coordinator — specifier pane is running a duplicate coordinator, not the specifier

Date: 2026-09-02 ~13:48 BST. Babysitter flagged an in_process parcel to
specifier stuck 34+ minutes (`00_20260902T120740Z_003415_from_coordinator_to_specifier`,
a priority-00 note re: BL-1286 deprecator hold).

## Investigation

The current swarm launch (tmux server on `.swarmforge/tmux/1523266553.sock`,
all sessions created 2026-09-02 13:18, presumably from a `./swarm ensure`
recovery earlier this session) mis-staffed the `swarmforge-specifier` tmux
session:

- `tmux list-panes` shows pane `swarmforge-specifier` is pane_pid **26327**.
- `/proc/26327/cmdline` is `zsh .../launch/coordinator.sh` (NOT
  `specifier.sh`), and its child (pid 26444) is a `claude` process launched
  with `--settings coordinator.claude-settings.json`, `--append-system-prompt-file
  prompts/coordinator.md`, remote-control name `SwarmForge-Coordinator`.
- There are TWO such coordinator claude processes: 26444 (squatting in the
  `swarmforge-specifier` pane) and 29810 (correctly in the `swarmforge-coordinator`
  pane). Zero specifier processes exist anywhere in this tmux server.

This means: no specifier agent is staffed at all. Any note/handoff routed to
specifier (including my own BL-1286 hold note and the older stuck parcel
above) will never be picked up until this is fixed.

## Minimal correct action taken

Per the constitution ("Requesting A Bounce", BL-107): I must not hand-edit
tmux/process state myself (risk of killing the wrong process, including
possibly this very coordinator session) and must not improvise a restart.
I re-wrote the `.swarmforge/bounce` sentinel (`swarm`) to request a proper
swarm bounce via the sanctioned path — the existing sentinel was already
present but stale/unconsumed (`bounce-ack.json` last updated 2026-08-22,
long before this launch), suggesting no extension host is currently
listening for it.

Escalating to the human via `role_ask.bb` since the sanctioned recovery
path may not be actively consumed, and duplicate-coordinator staffing is
a launch-assignment bug worth a ticket once resolved.

By coordinator.
