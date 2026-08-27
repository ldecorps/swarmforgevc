# Same-model seats bypass tier routing (BL-1167)

*How-to. Task-oriented: know when `--seat-tier` still applies on a multi-seat
coder stage, and when shared `--model` means either seat may take any
`mutation_cost`.*

## The gap

`cursor-forge` runs `coder` and `coder@cursor2` both on `--model auto`, with
`--seat-tier hard` / `easy`. BL-1001 then blocked medium/high tickets from the
easy seat even though the seats are model-equivalent — starving the second
seat without cutting bounce risk.

## What changed

`seat_difficulty_lib.bb` parses pack window `--model` values
(`parse-seat-models`). When **every** declared seat of a stage shares the
same effective model (`stage-models-equivalent?`), tier filtering is bypassed
and claim selection is BL-983 idle-first among those seats — any
`mutation_cost`. When models differ, BL-1001 tier rules apply unchanged.

| Pack models | Behaviour |
| --- | --- |
| All seats same `--model` | Either idle seat may claim low / medium / high |
| Distinct `--model`s | Easy = low only; hard = low/medium/high (BL-1001) |

Detection is **pack conf only** — not live agent state. Coordinator promote
stays stage-addressed.

## Operator check

On `cursor-forge` (both seats `--model auto`): promote a medium or high
`mutation_cost` ticket and confirm the idle easy seat can claim it. To
restore tier discipline, give the seats different `--model` values.

## Verify

```bash
bb swarmforge/scripts/test/seat_difficulty_lib_test_runner.bb
cd extension && npm test -- bl1167SameModelSeatRouting
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1167-same-model-coder-seats-bypass-tier-routing.feature
```

Related: [Difficulty-aware coder seat routing](BL-1001-difficulty-aware-coder-seat-routing.md).
