# Wire Mistral Vibe into the Intelligence Layer

Last Updated: 2026-08-24

Mistral Vibe (`vibe`) was already a live launch agent and pack family. The
Intelligence Layer could not route to it: ModelFactory had no `mistral` key in
`provider->agent`, and the Model Steward registry had no Mistral entry. This
guide is the bookkeeping half — registration and resolution only. It does not
certify the model or change packs/launchers.

## What this is (and is not)

| | |
|---|---|
| **Provider key** | `mistral` → launch agent `vibe` |
| **Seeded model** | `mistral/mistral-medium-3.5` (stable **alias** from `~/.vibe/config.toml`, never the rolling `mistral-vibe-cli-latest` name) |
| **Cost / window** | `medium`, context window `200000` (from live rates / `auto_compact_threshold`) |
| **Not this ticket** | Packs (`vibe-mono-router`, `vibe-forge`), `start-swarm-mistral.sh`, PromptEngine adapters (BL-574), certification / role assignment |
| **Do not confuse** | Old broken aider-based packs `mistral-lean.conf` / `two-pack-mistral.conf` — historical failure record only |

Adding the map entry must not change any other provider's resolution.
Registering the seed must not rewrite other models' status, window, or cost
class.

## Resolve the launch agent

```sh
bb -e '
  (load-file "swarmforge/scripts/model_steward_lib.bb")
  (load-file "swarmforge/scripts/model_factory_lib.bb")
  (println (pr-str (model-factory-lib/resolve-launch-agent "mistral")))
'
```

Expect `:known? true` and `:agent "vibe"`. Other keys stay as before
(`anthropic`→`claude`, `openai`→`codex`, `cerebras`→`aider`, `local`→`local-model`).

## Confirm the steward seed

After a fresh registry init from seed (or on a checkout that already absorbed
the seed):

```sh
bb swarmforge/scripts/model_steward_cli.bb show mistral/mistral-medium-3.5
```

Expect provider `mistral`, model `mistral-medium-3.5`, status `candidate`,
context window `200000`, cost class `medium`. Traceability fields on the seed
record the underlying vibe `name` and config rates — they are not a second
registry id.

If a host's vibe config cannot supply an id, registration falls back to
agent granularity (`mistral/vibe`) with an explicit reason — never invent a
plausible-looking model string.

## Related

| Doc / ticket | What it covers |
|---|---|
| [Model Steward overview](./BL-547-model-steward-overview.md) | Register / certify / evaluate lifecycle |
| [ModelFactory assign and apply](./BL-525-model-factory-assign-and-apply.md) | Assign / cold-apply after registration |
| [Route work to a local-model seat](./BL-1053-route-work-to-a-local-model-seat.md) | Parallel Intelligence Layer wiring for `local` |

Acceptance: `specs/features/BL-682-mistral-vibe-intelligence-layer-routing.feature`.
