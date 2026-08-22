# Launching the qwen-code mono-router pack

## Background

`qwen-code-mono-router` is a [BL-518-style mono-router](perplexity-mono-router-launch.md)
pack (rotation, one resident agent, coder home) running **qwen-code**
(`@qwen-code/qwen-code`, binary `qwen`) — Alibaba's own agentic CLI,
Gemini-CLI-derived — against the Token Plan OpenAI-compatible endpoint.

**This is not `swarmforge/packs/qwen-mono-router.conf`.** That existing pack
drives the same models, the same endpoint and the same key through **aider**,
a file editor with no autonomous shell execution — a role staffed that way
narrates `ready_for_next.sh` instead of running it, the same structural
failure already proven live with Mistral. qwen-code genuinely executes shell
commands: `--auth-type openai -y` is the YOLO/auto-approve flag (Claude's
`--dangerously-skip-permissions` equivalent), and without it the CLI refuses
and says so rather than pretending. Both packs are kept; pick by what the
seat has to **do**, not by the model catalog they share.

| Role band | Model |
|-----------|--------|
| coordinator | `qwen3.6-flash` (cheaper mechanical bookkeeping) |
| every other role (coder, specifier, cleaner, architect, hardender, documenter, QA) | `qwen3.7-plus` |

Also available on this plan, not used by default: `qwen3.8-max-preview`,
`qwen3.7-max`, `deepseek-v4-pro`, `glm-5.2`.

API base (OpenAI-compat, Token Plan SEA):
`https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` — the
CLI reads this from the environment; there is no flag for it, so the launcher
exports it via the `qwen_guard` below rather than a command-line argument.

## Terms of Service — read before launching

> Personal ToS limits use to interactive coding tools; headless swarm may
> risk key revocation — prefer Team Edition for automation, or verify
> eligibility in console first.

This pack makes the seat *possible*; it does not decide that running it
headless against a Personal plan is allowed. That call is the operator's,
per launch — the warning is carried verbatim in the pack file itself
(`swarmforge/packs/qwen-code-mono-router.conf`) so nobody launches without
reading it.

## Prerequisites

- `npm i -g @qwen-code/qwen-code` — installs the binary as `qwen`, **not**
  `qwen-code`; the agent name in the pack and its executable differ.
- `QWEN_API_KEY` in the environment, or `BAILIAN_CODING_PLAN_API_KEY` as a
  fallback (e.g. `~/.zshenv`; never commit keys — the key reaches the pane
  only via the launching environment and tmux `-e`, never written into a
  pack file, a generated launch script, a prompt, or a commit).

## Launch

```sh
source ~/.zshenv
export SWARMFORGE_TERMINAL=none
./swarm <repo-root> --pack qwen-code-mono-router
```

The pack's `qwen_guard` maps `QWEN_API_KEY` (falling back to
`BAILIAN_CODING_PLAN_API_KEY`) onto `OPENAI_API_KEY` / `OPENAI_API_BASE` /
`OPENAI_BASE_URL` for the Token Plan endpoint and sets
`SWARMFORGE_USE_QWEN=1`, the same credential plumbing
`qwen-mono-router` already uses — same credentials, different launcher. A
qwen-code seat is Token Plan by construction: naming the agent `qwen-code`
is itself one of the force triggers for that mapping, so it fires even
before any window line's `--model`/`extra_cli` is examined.

Verify the seat is a real agent, not a narrator: in the role pane, ask it to
run `ready_for_next.sh` and confirm the pane shows the command's actual
output, not a description of what it would do — the exact check the
aider-based pack fails.

## Repair

```sh
source ~/.zshenv
SWARMFORGE_TERMINAL=none ./swarm ensure <repo-root> --pack qwen-code-mono-router
```

Expect `agent:coder` and `agent:coordinator` **HEALTHY**; other pipeline
roles **DORMANT** (rotation targets) until rotated in. Extension host
**FAILED** under `SWARMFORGE_TERMINAL=none` is normal.

## Idle / open-slot behavior, and the endless-loop hard stop

Same mono-router rules as every other rotation pack — see
[Launching the Perplexity mono-router pack](perplexity-mono-router-launch.md)
("Idle / open-slot behavior" and "Endless-loop hard stop") and
`swarmforge/PIPELINE.md` ("Mono-router idle and open slots"). The home
resident must not busy-loop `ready_for_next.sh` on `NO_TASK`; three
consecutive chase hits of that pattern stop the whole swarm.

## Not staffed by this pack

The ModelFactory `provider->agent` entry and the Model Steward cost-class
registration for qwen-code are a separate ticket (BL-1053) — registering a
provider with nothing to launch would be inert bookkeeping, so this pack
(the launch adapter, the agent shape, the pack itself) had to land first.
The existing aider-based `qwen-mono-router` pack is untouched by this work.
