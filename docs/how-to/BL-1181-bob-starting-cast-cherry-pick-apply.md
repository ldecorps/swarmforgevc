# BoB starting cast — steward cherry-pick export and apply (BL-1181)

*How-to. Epic BL-1180 quick-start slice — steward exports one certified model
per role and applies it through existing ModelFactory / pack surfaces.*

## What runs where

| Path | Module | Behaviour |
| --- | --- | --- |
| Export | `swarmforge/scripts/bob_starting_cast_lib.bb` | `export-bob-starting-cast` cherry-picks top certified recommendation per role |
| CLI | `swarmforge/scripts/bob_starting_cast_cli.bb` | `export` / `apply` verbs for operators |
| Apply orchestration | `extension/src/tools/bobStartingCastApply.ts` | Memory transfer for changed roles, then overlay write |
| Assignment | ModelFactory overlay or pack `--model` apply | Only allowed paths — no third assignment route |
| Memory | `agentMemoryTransfer.ts` (BL-1177) | Capture/inject before live work when apply changes a role's model |

Mixed vendors across roles are allowed in the export. Apply fails closed on
inject errors (same posture as BL-1178).

## Operator flow

```bash
bb swarmforge/scripts/bob_starting_cast_cli.bb export
bb swarmforge/scripts/bob_starting_cast_cli.bb apply --cast /path/to/cast.json
```

Export names exactly one `(provider, model)` per role from Model Steward
certified rankings. Apply writes through `model-factory-overlay` (or pack
model apply when that path is selected) and runs agent-memory transfer for
roles whose model changes.

## Verify

```bash
bb swarmforge/scripts/test/bob_starting_cast_test_runner.bb
cd extension && npm test -- bobStartingCastApply
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1181-bob-starting-cast-cherry-pick-apply.feature
```

Related: [BL-1177 portable payload](BL-1177-portable-agent-memory-payload-capture-inject.md);
[BL-1178 hot-swap wiring](BL-1178-wire-agent-memory-into-hot-swap-and-trial.md).
