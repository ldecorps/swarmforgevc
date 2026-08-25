# BL-657 — harness-descended start-swarm survives

## Problem

Starting the swarm from a Claude Code or Cursor shell used to create both
tmux sessions, then kill the whole tmux server about 1–3 seconds later.
Cron launches and hand-built sessions were fine.

## Cause

The first `tmux new-session` forks a long-lived server that keeps the
launcher’s environment. Markers like `CLAUDE_CODE_CHILD_SESSION` stuck on
that server and poisoned every pane.

## Fix

1. `swarmforge/scripts/harness_env_scrub.sh` unsets harness markers in the
   launcher process and clears them on the tmux server with
   `set-environment -gu`.
2. `swarmforge.sh` and `start-swarm.sh` both scrub before any tmux server
   can be started.
3. `wait_for_ready` waits past the 1–3s death window and, on failure,
   writes `.swarmforge/start-swarm-fail-diag.txt` instead of only printing
   “did not become ready”.

Intentional knobs kept: `CLAUDE_CODE_MAX_OUTPUT_TOKENS`,
`CLAUDE_CODE_OAUTH_TOKEN`.

## Verify

```bash
bb swarmforge/scripts/test/harness_env_scrub_test_runner.bb
bash swarmforge/scripts/test/test_harness_env_scrub_bl657.sh
bb swarmforge/scripts/test/swarm_detach_lib_test_runner.bb
```

From a harness shell (optional live check):

```bash
# after stop — do not run against a live night swarm without intent
CLAUDE_CODE_CHILD_SESSION=1 ./start-swarm.sh
# sessions must still exist ~60s later
```
