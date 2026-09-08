# Launching the GLM mono-router pack

## Background

`glm-mono-router` is a mono-router pack on the b.ai gateway: one resident
**aider** agent (home = **coder**) rotates through the pipeline stages coder,
cleaner, architect, hardender, documenter and QA, with a separately
provisioned **aider** coordinator. All of those seats run
`tencentcloud2/glm-5.3-flash` via the b.ai OpenAI-compatible API; the
**specifier** seat runs Claude Code on `claude-fable-5-1` instead — both
models certified in the registry on 2026-09-08
(`docs/reference/model-compatibility.md`).

API base is `https://api.b.ai/v1`.

## Prerequisites

- `B_AI_API_KEY` in the environment (e.g. `~/.zshenv`; never commit the key
  — names only in any committed file, same discipline as every other
  provider key in this repo, BL-130).
- `aider` on `PATH` (pipx) for the coordinator/worker seats.
- `claude` CLI on `PATH` for the specifier seat.

## Launch

```sh
source ~/.zshenv   # exports B_AI_API_KEY
./start-swarm-glm.sh
```

`start-swarm-glm.sh` unsets the other provider `SWARMFORGE_USE_*` flags and
`OPENAI_API_BASE`/`OPENAI_BASE_URL`, refuses to start if `B_AI_API_KEY` is
missing or `aider`/`claude` are not on `PATH`, then exports
`SWARMFORGE_USE_BAI=1` and `SWARMFORGE_PACK=glm-mono-router` before
delegating to `start-swarm.sh`. This wrapper exists because the provisioned
aider coordinator has no window line to sniff a host from — it takes the
`SWARMFORGE_USE_BAI` flag from the launching shell, not from pane CLI flags,
so `SWARMFORGE_PACK=glm-mono-router ./start-swarm.sh` alone would seat the
workers and leave the coordinator without a base URL.

`SWARMFORGE_USE_BAI=1` makes launch / ensure / rotate / chase / respawn map
`B_AI_API_KEY` onto `OPENAI_API_KEY` + `OPENAI_API_BASE` for panes and
**excludes** a host `OPENAI_API_KEY` so real OpenAI credentials cannot
shadow the b.ai gateway (same posture as Cerebras/Perplexity/Qwen).

## Repair

```sh
source ~/.zshenv
SWARMFORGE_USE_BAI=1 SWARMFORGE_TERMINAL=none ./swarm ensure <repo-root> --pack glm-mono-router
```

Expect `agent:coder` and `agent:coordinator` **HEALTHY**; other pipeline
roles **DORMANT** (rotation targets). A respawned worker re-derives its
`OPENAI_API_KEY`/`OPENAI_API_BASE` from `B_AI_API_KEY` the same way the
initial launch did, so it re-authenticates without manual intervention.

## Coordinator model

Packs that set `config coordinator_agent aider` must also set
`config coordinator_model <id>` (here `openai/glm-5.3-flash`). Without that,
the coordinator starts as bare `aider` and cannot talk to the b.ai gateway.

## Verifying the key never leaks

- `tmux -S <swarm socket> show-environment -g | grep -c B_AI_API_KEY` should
  print `0` — the key is scrubbed from the tmux server's global environment.
- `tmux -S <socket> show-environment -t swarmforge-coder | grep -c
  '^OPENAI_API_BASE=https://api.b.ai/v1'` should print `1` — the pane still
  has the mapped base URL.
- `git grep -n B_AI_API_KEY` should list names only, never a value.

## Idle / open-slot behavior

See `swarmforge/PIPELINE.md` ("Mono-router idle and open slots"). Home
resident must not busy-loop `ready_for_next.sh` on `NO_TASK`; open capacity
with paused work is a coordinator promote+route job.

## Endless-loop hard stop

The handoff daemon watches resident panes for a repeated `ready_for_next` →
`NO_TASK` spin. Three consecutive chase hits (~15s) of that pattern **stop
the swarm** (Telegram Operator alert + email + `kill_all_swarm.sh`) so
tokens are not burned on a no-op loop. After a halt, fix the cause and
relaunch.
