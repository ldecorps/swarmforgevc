# BL-657 evidence — harness env scrub — 2026-07-29

## Problem
start-swarm from a harness-descended shell: tmux sessions appear, then the
tmux server dies in 1–3s. Cron / manual assembly survived.

## Fix landed
- `swarmforge/scripts/harness_env_scrub.sh` + `harness_env_scrub_lib.bb`
- Wired into `swarmforge.sh` (before first tmux probe + after new-session)
  and `start-swarm.sh` (before nohup launch + during wait)
- `wait_for_ready` rechecks after a 5s survival window; failures write
  `.swarmforge/start-swarm-fail-diag.txt`
- Detach success message clarified: SIGHUP-ignored ≠ session survival

## Tests (2026-07-29)
- `bb swarmforge/scripts/test/harness_env_scrub_test_runner.bb` — PASS
- `bash swarmforge/scripts/test/test_harness_env_scrub_bl657.sh` — PASS
- `bb swarmforge/scripts/test/swarm_detach_lib_test_runner.bb` — PASS
- `bash swarmforge/scripts/test/test_swarm_outlives_launcher.sh` — PASS

## Live full-stack launch (2026-07-29 20:42 UTC+1)
Cold start from a Cursor shell with poison markers set:

```text
CLAUDE_CODE_CHILD_SESSION=1
CLAUDECODE=1
CURSOR_AGENT=1
CURSOR_CONVERSATION_ID=bl657-live-verify
./start-swarm.sh
```

Observed:
- `Sessions visible (4) — waiting past the BL-657 failure window ...`
- then `SwarmForge agents are up: 4 session(s)`
- at t+60s: all four sessions still listed; tmux server pid still responding
- global + coder session env: no `CLAUDE_CODE_CHILD_SESSION` / `CLAUDECODE` /
  `CURSOR_AGENT` / `CURSOR_CONVERSATION_ID` / `__CURSOR_SANDBOX_ENV_RESTORE`
- `./swarm ensure` reported agents + daemon + operator + front-desk HEALTHY

## How-to
`docs/how-to/BL-657-launcher-tmux-server-dies-seconds-after-launch.md`
