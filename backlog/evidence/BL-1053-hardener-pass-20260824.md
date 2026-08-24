# BL-1053 — hardener pass — 20260824

Received architect tip `629149e6fd` (Article 4.4 inventory NONE). Merged into
`swarmforge-hardender` as `d93ceef85`. Parcel task name is BL-1053 only
(reframed `local` → `local-model` slice).

## BL-149 cooldown gate

| path | decision |
|---|---|
| `swarmforge/scripts/model_factory_lib.bb` | **skip-cooldown** (file_age_days ≈ 0.84 on `main`; recent BL-1079 churn) |
| `specs/features/BL-1053-….feature` | **skip-cooldown** (file_age_days ≈ 1.31 on `main`) |
| `specs/pipeline/steps/index.js` | **skip-cooldown** (hub file, recent on `main`) |
| `specs/pipeline/steps/bl1053LocalProviderRoutingSteps.js` | **run** (no history on `main` yet — BL-463 epoch → eligible) |

Host quiet (load ≈ 1.5–1.8 on 20 cores). Per BL-149:

- No hand-authored mutation of `model_factory_lib.bb` this pass.
- Soft Gherkin mutation of the feature (Scenario Outline
  `local-provider-routing-02`) deferred to a quiet post-cooldown pass —
  same handling as BL-1079 the day prior.

## What DID run

Surgical mutation sweep over the brand-new step handler
(`swarmforge/scripts/test/bl1053_local_provider_routing_mutation_sweep.sh`),
oracle = `run_acceptance.sh` on the BL-1053 feature. Stryker cannot see
`specs/pipeline/steps/` (`mutate: out/**/*.js` only).

| mutant | result |
|---|---|
| LOCAL_MODEL_AGENT → codex | killed |
| LOCAL_PROVIDER → openai | killed |
| openai agent → claude | killed |
| anthropic agent → codex | killed |
| cerebras agent → claude | killed |
| known always true | killed |
| agent always null | killed |
| Given rejects local registrations | killed |
| cost class assert forced medium | killed |
| allow-list regex never matches | killed |
| agent-nil check dropped | **equivalent** — edn `:agent nil` is unquoted, so the capture match fails and `\|\| null` already yields null |
| SEAT_LAUNCHED_MODEL renamed | **equivalent** — fixture writes and asserts the same constant |

**Final: killed=10, survived=0 (non-equivalent), skipped=0, equivalents=2.**

## Verification (fresh this pass)

| check | result |
|---|---|
| `bl1053_local_provider_routing_test_runner.bb` | ALL PASS |
| `bl1053_provider_routing_property_runner.bb` | ALL PROPERTIES HELD (300) |
| `model_factory_test_runner.bb` | ALL PASS |
| `test_model_factory_cli.sh` | 16/16 + 01d/01e PASS |
| `run_acceptance.sh` BL-1053 feature | 8/8 |

CRAP / DRY / Stryker: not applicable (parcel surface is `.bb` +
`specs/pipeline/steps/`, not `extension/src/*.ts` → `out/`).

## Orphans

No leftover `node --test` / `stryker` / `mutationWorker` / gherkin processes
scoped to this worktree. Step-handler source byte-identical after the sweep.

## Outstanding (not this ticket)

BL-113 soft Gherkin mutation of
`specs/features/BL-1053-the-intelligence-layer-can-route-work-to-a-local-model-seat.feature`
and a language-mutation re-pass on `model_factory_lib.bb` once past the
BL-149 cooldown window — coordinator sequences the quiet re-pass.

## Verdict: PASS — forwarding to documenter.

By hardender.
