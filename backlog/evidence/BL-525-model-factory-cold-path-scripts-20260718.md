# BL-525 / GPT mono-router — official script health (2026-07-18)

## Goal
Operate GPT `codex-mono-router` via SwarmForge entrypoints (`./swarm`,
`./swarm ensure`, `failover_to_gpt.sh`), not ad-hoc one-liners.

## What was broken
1. `./swarm --help` treated `--help` as `<project-root>` → `cd` failure.
2. `./swarm ensure` on mono-router listed every `roles.tsv` role as FAILED
   and attempted `respawn-pane` for dormant rotate targets (specifier…QA).
3. Ensure respawn `-e` only forwarded OpenRouter — GPT/Codex repairs could
   lose `OPENAI_API_KEY`.
4. `failover_to_gpt.sh` used bare `exec ./swarm` with no post-launch verify.

## Fixes
- `swarmforge.sh`: `--help` / `-h` / `help` usage and early exit.
- `swarm_ensure.bb`: mono-router standing shape → `DORMANT`; `provider-respawn-env-args`.
- `handoff_lib.bb`: Cerebras→OPENAI map when `SWARMFORGE_USE_CEREBRAS=1`.
- `failover_to_gpt.sh`: prerequisites, nohup launch, wait for sessions.
- `test_swarm_ensure.sh`: mono-router dormant scenario.

## Verification
- `./swarm --help` prints usage.
- `./swarm ensure <live>` → coder/coordinator HEALTHY; pipeline roles DORMANT.
- `bash swarmforge/scripts/test/test_swarm_ensure.sh` — ALL PASS incl. dormant.

## Residual
- Extension may FAILED without VS Code host (expected headless).
- BL-525 Slice 2 hot-swap / full ModelFactory still todo.
