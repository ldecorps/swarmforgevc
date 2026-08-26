# Route work to a local-model seat (intelligence layer)

Last Updated: 2026-08-24

Pull and serve the model ([BL-1082](./BL-1082-pull-and-serve-a-named-model.md)),
then staff the seat ([BL-1052](./BL-1052-local-model-seat-launch.md)). This
guide is the bookkeeping half: register an on-host model under the **`local`**
provider so ModelFactory can select the **`local-model`** launch agent.

Registration makes a model **selectable**. It never mutates a live seat on
its own — cold-apply still goes through
[ModelFactory assign and apply](./BL-525-model-factory-assign-and-apply.md).

## What this is (and is not)

| | |
|---|---|
| **Provider key** | `local` → launch agent `local-model` in ModelFactory's `provider->agent` map |
| **Not this key** | `openai` — still resolves to `codex`. A local endpoint may speak OpenAI-compat protocol, but the provider key names **which CLI launches the model**, not which wire protocol it speaks |
| **Cost class** | Existing `low` (already rank 0 / cheapest). No new `free` rank |
| **Second model** | Steward registration only under `local/...` — never a new map entry |
| **Not this ticket** | Pull/serve (BL-1082); seat pack/launch (BL-1052); autonomous seat mutation |

Unknown providers **report as unknown** (no launch agent) instead of echoing
the provider name as if it were an agent. Assign refuses a candidate whose
provider has no map entry.

## Register the first-quest candidate

```sh
bb swarmforge/scripts/model_steward_cli.bb register local/qwen2.5-coder:7b-instruct \
  --status candidate \
  --cost-class low
```

Confirm:

```sh
bb swarmforge/scripts/model_steward_cli.bb show local/qwen2.5-coder:7b-instruct
```

Expect provider `local` and cost class `low`. Do **not** register the same
id under `openai/...`.

## Resolve the launch agent

From Babashka (same report shape acceptance uses):

```sh
bb -e '
  (load-file "swarmforge/scripts/model_steward_lib.bb")
  (load-file "swarmforge/scripts/model_factory_lib.bb")
  (println (pr-str (model-factory-lib/resolve-launch-agent "local")))
'
```

Expect `:known? true` and `:agent "local-model"`. Cloud keys stay unchanged
(`anthropic`→`claude`, `openai`→`codex`, `cerebras`→`aider`,
`mistral`→`vibe`). An unknown
key reports `:known? false` and `:agent nil` with a reason that names the
provider and the known keys.

## Add a second downloaded model

```sh
bb swarmforge/scripts/model_steward_cli.bb register local/llama3.1:8b \
  --status candidate \
  --cost-class low
```

No edit to `provider->agent` is required. Both models stay under `local`.

## Related

| Doc / ticket | What it covers |
|---|---|
| [BL-1082 pull and serve](./BL-1082-pull-and-serve-a-named-model.md) | Ollama store + loopback endpoint |
| [BL-1052 local-model seat](./BL-1052-local-model-seat-launch.md) | Pack, launch, health refusal |
| [ModelFactory assign and apply](./BL-525-model-factory-assign-and-apply.md) | Assign / cold-apply after registration |
| [Model Steward overview](./BL-547-model-steward-overview.md) | Register / certify lifecycle |
| [Wire Mistral Vibe into the Intelligence Layer](./BL-682-mistral-vibe-intelligence-layer-routing.md) | Parallel `mistral`→`vibe` map + seed |

Acceptance: `specs/features/BL-1053-the-intelligence-layer-can-route-work-to-a-local-model-seat.feature`.
