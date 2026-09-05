# BL-1439 — gherkin-mutation discharge for BL-956, 2026-09-05

## Gate

`gherkin-mutation` on `specs/features/BL-956-pipeline-board-caption-and-cap-hotfix.feature`
(the ledger row deferred 2026-08-19: "run stalled at completed=0
running=0, worker CPU flat 0.10s for 2.5min (BL-687 signature)").

## Run

```
bash specs/pipeline/scripts/run_gherkin_mutation.sh \
  specs/features/BL-956-pipeline-board-caption-and-cap-hotfix.feature \
  "" specs/pipeline/steps/index.js full
```

Full run of the pinned, vendored gherkin-mutator (`swarmforge/vendor/aps`)
against `specs/pipeline/steps/index.js`, level `full` (no reuse of any
prior stamp - the original attempt never produced a verdict, so there was
nothing to reuse from). Completed cleanly this time: `status elapsed=19116ms
total=6 completed=6 running=0 killed=6 survived=0 errors=0` - no stall,
no flat-CPU signature, a real verdict on every generated mutant.

## Result

```json
{"summary": {"Total": 6, "Killed": 6, "Survived": 0, "Errors": 0}, "outcome": "pass"}
```

6 mutants generated over the feature's `Scenario Outline` examples (the
below-grid-list cap scenario's numeric/token/overflow-text fields), all 6
killed - every mutation to a count, a ticket kind, or an overflow-text
literal produces a scenario failure the acceptance harness catches. Zero
survivors, zero errors.

## Discharge

```
bb swarmforge/scripts/hardening_debt_ledger_update.bb . --discharge \
  BL-956-pipeline-board-caption-and-cap-hotfix gherkin-mutation \
  --evidence backlog/evidence/BL-1439-bl956-gherkin-mutation.md
```

Matches the ledger row by (parcel, gate) - the row's own `parcel` field
is the slug `BL-956-pipeline-board-caption-and-cap-hotfix`, not the bare
ticket id (the ledger's own convention; `pipeline_stage_lib.bb`'s
extractor resolves it to `BL-956` for the register's ownership join,
unaffected by this discharge).
