# Staff a role seat with a downloaded local model

Last Updated: 2026-09-25

Pull and serve the model first ([BL-1082](./BL-1082-pull-and-serve-a-named-model.md)).
This guide staffs every mono-router window with the **`local-model`** agent
against that loopback OpenAI-compatible endpoint. Routing work to the seat
is [BL-1053](./BL-1053-route-work-to-a-local-model-seat.md).

## What this is (and is not)

| | |
|---|---|
| **This pack** | `swarmforge/packs/local-model-mono-router.conf` — agent token `local-model`, shell-capable, model id on the window line |
| **Not this pack** | `qwen-mono-router.conf` — agent `aider`, file-editor shape, no autonomous shell. Keep both; pick by what the seat must **do**, not by the model catalog they may share. What an aider seat receives at launch: [BL-1697's how-to](./BL-1697-local-parcel-driver.md#what-an-aider-seat-receives-at-launch-bl-1699) |
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

### Ollama is started by the swarm (BL-1703)

Before any seat starts, the launch path probes the local endpoint for any
pack whose seats use it — either a `local-model` agent window, or an
`aider` window naming the endpoint directly on its own line (e.g.
`--openai-api-base http://127.0.0.1:11434/v1`, the shape every
`ollama-*-mono-router.conf` pack uses):

- **Answers** — recorded `external` and the launch proceeds. Something
  else (for example the Local Agent, or a hand-started server) is already
  serving it, and the swarm leaves it alone.
- **Silent** — the swarm starts `ollama serve` detached, waits for it to
  answer (bounded wait, polled), and records `swarm-owned` with its pid
  and start time.
- **Never answers** — the swarm stops whatever it started, writes no
  record, and refuses the launch before any seat exists, naming the
  endpoint and the server log path.
- **No seat on the local endpoint** — no probe, no record, launch
  unchanged.

The record lives at `.swarmforge/ollama/serve.json` (`owner`: `external` or
`swarm-owned`, `pid`, `startedAt`, `endpoint`) — read by the stop path so a
server the swarm did not start is never stopped by the swarm (it may be
serving something else, like the Local Agent chat).

`swarm.env` keys (all optional; the defaults reproduce the previous
hand-run shape — bare `ollama serve`, native context length):

| Key | Meaning | Default |
|---|---|---|
| `SWARMFORGE_OLLAMA_BINARY` | the `ollama` binary to run | `ollama` |
| `SWARMFORGE_OLLAMA_MODELS_DIR` | `OLLAMA_MODELS` for the started server | unset (binary default) |
| `SWARMFORGE_OLLAMA_CONTEXT_LENGTH` | `OLLAMA_CONTEXT_LENGTH` for the started server | unset (binary default) |
| `SWARMFORGE_OLLAMA_WAIT_SECONDS` | bound on how long the launch waits for a newly started server to answer | `30` |
| `SWARMFORGE_OLLAMA_POLL_INTERVAL_SECONDS` | how often the wait re-probes | `1` |

Restarting a crashed server mid-shift is not covered here — this is a
launch-time gate only. Stopping a swarm-owned server (BL-1704) and
reaping ghost runners / detached run clients (BL-1705) are separate,
not-yet-documented tickets from the same intake.

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
| [BL-1053 route to local-model seat](./BL-1053-route-work-to-a-local-model-seat.md) | Intelligence-layer routing (`local`→`local-model`) |

Acceptance: `specs/features/BL-1052-a-role-seat-can-be-staffed-by-a-downloaded-local-model.feature`.
