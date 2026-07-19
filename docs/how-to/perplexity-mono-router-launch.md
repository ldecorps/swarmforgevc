# Launching the Perplexity mono-router pack

## Background

`perplexity-mono-router` is a BL-518-style mono-router pack: one resident
**aider** agent (home = **coder**) rotates through the full pipeline stages,
with a separately provisioned **aider** coordinator. Models are Perplexity
Sonar via the OpenAI-compatible API.

| Role band | Model |
|-----------|--------|
| specifier, architect | `openai/sonar-reasoning-pro` |
| coder, hardender, QA | `openai/sonar-pro` |
| cleaner, documenter, coordinator | `openai/sonar` |

API base is `https://api.perplexity.ai` (**no `/v1`** — that path 404s).

## Prerequisites

- `PERPLEXITY_API_KEY` in the environment (e.g. `~/.zshenv`; never commit keys).
- Optional convenience file `.swarmforge/perplexity.env` containing only
  `SWARMFORGE_USE_PERPLEXITY=1` (non-secret).
- `aider` on `PATH` (pipx).

## Launch

```sh
source .swarmforge/perplexity.env   # sets SWARMFORGE_USE_PERPLEXITY=1
export SWARMFORGE_TERMINAL=none
./swarm <repo-root> --pack perplexity-mono-router
```

`SWARMFORGE_USE_PERPLEXITY=1` makes launch / ensure / rotate / chase map
`PERPLEXITY_API_KEY` onto `OPENAI_API_KEY` + `OPENAI_API_BASE` for panes and
**suppresses** a host `OPENAI_API_KEY` so real OpenAI credentials cannot shadow
Sonar (same posture as Cerebras).

## Repair

```sh
source .swarmforge/perplexity.env
SWARMFORGE_TERMINAL=none ./swarm ensure <repo-root> --pack perplexity-mono-router
```

Expect `agent:coder` and `agent:coordinator` **HEALTHY**; other pipeline roles
**DORMANT** (rotation targets). Extension host **FAILED** under
`SWARMFORGE_TERMINAL=none` is normal.

## Coordinator model

Packs that set `config coordinator_agent aider` must also set
`config coordinator_model <id>` (here `openai/sonar`). SwarmForge passes
`--model` into the coordinator launch for aider the same way it already did for
claude and codex. Without that, the coordinator starts as bare `aider` and
cannot talk to Perplexity.

## Idle / open-slot behavior

See `swarmforge/PIPELINE.md` (“Mono-router idle and open slots”) and
`swarmforge/packs/perplexity-mono-router.prompt`. Home resident must not
busy-loop `ready_for_next.sh` on `NO_TASK`; open capacity with paused work is a
coordinator promote+route job.

## Endless-loop hard stop

The handoff daemon watches resident panes for a repeated `ready_for_next` →
`NO_TASK` spin. Three consecutive chase hits (~15s) of that pattern **stop the swarm**
(operator email + `kill_all_swarm.sh`) so tokens are not burned on a no-op
loop. After a halt, fix the cause and relaunch.
