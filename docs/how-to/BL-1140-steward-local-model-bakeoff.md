# Steward-driven local model bake-off (BL-1140)

Epic BL-1125 remaining slice: **which** local model to use on this WSL/CPU
host. The human has no strong opinion; Model Steward decides from
battery / scorecard evidence — not from a hand-written STEERING ranking.

The fabricated tag `human-operator-priority:ollama-local-qwen-20260825` is
**revoked** as a standing human model pick. Local Ollama investment stays;
this ticket does **not** cold-swap the live day-shift off `cursor-forge`
unless asked separately.

## Ranking authority (role-matrix)

`role-recommendations` in `model_steward_lib.bb` sorts by:

1. **Authority tier** (lower wins): `0` = battery / scorecard / bake-off
   citation; `1` = other evidence; `2` = revoked
   `human-operator-priority:ollama-local-qwen-20260825`
2. Then **score** (higher wins)

So a battery pass always outranks a revoked human-priority row, even if the
revoked row has a higher numeric score.

```bash
bb swarmforge/scripts/model_steward_cli.bb role-matrix coder
```

Coder's top **local** recommendation must cite battery or scorecard evidence
— never the revoked human-priority tag as authoritative outrank.

## Bake-off ingest

`apply-local-bakeoff-results` folds per-candidate BL-1127 battery results
(`{:provider :model :result :path}`) into the role-matrix via the same
eligibility helpers as BL-1127. Pass → score `1.0` with the evidence path;
fail → `0.0`.

## Local pack alignment

`local-pack-align-outcome` inspects a pack conf body (`--model <id>`) against
the top local steward recommendation:

| Steward state | Outcome |
|---------------|---------|
| Top eligible local recommendation | `:aligned` when pack `--model` matches (Ollama ids as `openai/<name>`) |
| No local winner yet | `:no-winner-yet` (clear refusal path) |
| Pack model differs | `:mismatch` |

Inspection only — applying / generating the pack is a separate step; this
helper never implies rewriting `cursor-forge`.

## Related

- [Model Steward overview](BL-547-model-steward-overview.md)
- [Local coder evidence bar (BL-1127)](BL-1127-local-coder-steward-evidence-bar.md)
- [Pull and serve a named model](BL-1082-pull-and-serve-a-named-model.md)

Acceptance:
`specs/features/BL-1140-steward-local-model-bakeoff.feature`
