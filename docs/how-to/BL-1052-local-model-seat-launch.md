# Staff a role seat with a downloaded local model

Last Updated: 2026-08-23

Pull and serve the model first ([BL-1082](./BL-1082-pull-and-serve-a-named-model.md)).
This guide staffs every mono-router window with the **`local-model`** agent
against that loopback OpenAI-compatible endpoint. Routing work to the seat
is **BL-1053** (not covered here).

## What this is (and is not)

| | |
|---|---|
| **This pack** | `swarmforge/packs/local-model-mono-router.conf` — agent token `local-model`, shell-capable, model id on the window line |
| **Not this pack** | `qwen-mono-router.conf` — agent `aider`, file-editor shape, no autonomous shell. Keep both; pick by what the seat must **do**, not by the model catalog they may share |
| **First-quest binary** | `qwen` from `@qwen-code/qwen-code` (OpenAI-compat auth against loopback). The agent **token** stays `local-model`; babysitter/`./swarm ensure` look for argv needle `qwen` via `agent_process_marker_lib.bb` |
| **Not the old qwen-code seat** | The withdrawn `qwen-code-mono-router` / Token Plan cloud path was superseded; see `backlog/evidence/BL-1052-BL-1053-supersede-disposition-20260823.md` |

Invariants: a capability entry describes the **agent**, never the model;
swapping to a second downloaded model is a window-line `--model` change
only; secrets never land in the pack, generated launch script, or prompt.

## Prerequisites

1. BL-1082 pull + serve for the model id you will put on the window line
   (default first quest: `qwen2.5-coder:7b-instruct`). OpenAI-compat base
   URL ready at loopback (default `http://127.0.0.1:11434/v1`; override with
   `SWARMFORGE_LOCAL_MODEL_ENDPOINT_URL`). The launcher forces
   `OPENAI_API_BASE` / `OPENAI_BASE_URL` to that URL in the pane — never a
   Token Plan cloud host.
2. `qwen` on `PATH` (`npm i -g @qwen-code/qwen-code`).
3. No cloud provider API key required. An optional local OpenAI-compat
   client token may sit in the launching environment and reaches the pane
   only via tmux `-e` (BL-130) — never written into pack or launch files.

## Launch

```sh
source ~/.zshenv   # or whatever exports optional local client token
SWARMFORGE_TERMINAL=none ./swarm <scratch-root> --pack local-model-mono-router
```

Every role window names agent `local-model` and a `--model <id>`. Launch is
**refused** when the local endpoint health check is not ready — the refusal
names the endpoint.

## Repair

```sh
SWARMFORGE_TERMINAL=none ./swarm ensure <scratch-root> --pack local-model-mono-router
```

Expect `agent:<role>` HEALTHY when the `qwen` child is present;
`rc:<role>: OFF` (remote control is off for this pack — heal via `agent:`,
not Claude `/rc`). A shell-only pane with no `qwen` descendant is repaired
by respawning the persisted role launch script.

## Swap the model (generic path)

Edit the window lines (and coordinator model) in
`local-model-mono-router.conf` — change only the model id. No second launch
branch, capability entry, or pack family. Serve the new id with BL-1082
before relaunch.

## Related

| Doc / ticket | What it covers |
|---|---|
| [BL-1082 pull and serve](./BL-1082-pull-and-serve-a-named-model.md) | Ollama store + loopback endpoint |
| [BL-514 remote-control / ensure](./BL-514-remote-control-health-and-ensure-wiring.md) | `rc:` OFF + `agent:` heal |
| [babysitterd runbook](./BL-611-babysitterd-runbook.md) | Process marker for `local-model` → `qwen` |
| BL-1053 | Intelligence-layer routing to a local-model seat |

Acceptance: `specs/features/BL-1052-a-role-seat-can-be-staffed-by-a-downloaded-local-model.feature`.
