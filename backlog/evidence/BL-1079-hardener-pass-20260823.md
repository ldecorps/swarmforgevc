# BL-1079 — hardener pass — 20260823 (Cursor thin-pass; Claude weekly-capped)

## Context

Received architect tip `3a8dd8d820` (PASS — dependency-gate / co-change /
properties). Merged into `swarmforge-hardender` as `44fec9917` (conflict in
`babysitterd_sweep_lib_test_runner.bb`: keep BL-1071 unavailable coverage,
drop bounced BL-1081 ACP tests — same resolution as architect/cleaner).

Self-handoff after an empty `done_with_current` on the prior claim; this pass
is the real harden.

## BL-149 cooldown gate

```
specs/features/BL-1079-….feature          skip-cooldown (file_age_days: 0.45)
swarmforge/scripts/model_factory_lib.bb   skip-cooldown (file_age_days: 0.47)
swarmforge/model-steward/seed/models.seed.json
                                          skip-cooldown (file_age_days: 0.47)
swarmforge/scripts/model_steward_lib.bb   run (file_age_days: 31.94)
swarmforge/scripts/model_steward_cli.bb   run (file_age_days: 31.82)
swarmforge/scripts/model_steward_store.bb run (file_age_days: 31.94)
specs/pipeline/steps/bl1079CursorStewardCertifySteps.js
                                          run (bogus age from untracked-on-main shape)
```

Host quiet (load ~1.55 on 20 cores). Per BL-149, **BL-113 soft Gherkin
mutation of the feature is deferred** — the feature (and its Scenario Outline)
is inside the 3-day cooldown window. Same handling as BL-1088 this same day:
forward with targeted hardening; full Gherkin mutation lands on a later quiet
pass once past cooldown. `model_factory_lib.bb`'s cursor→cursor map is likewise
deferred.

## What DID run

**Surgical bb mutation sweep** (BL-567 / BL-638 pattern) over the scorecard
gate the parcel actually owns — steward lib/cli/store — against unit + CLI +
BL-1079 certification-gate property:

| mutant | result |
|---|---|
| cli: drop missing-scorecard refuse | killed (cli) |
| cli: refuse when scorecard present | killed (cli) |
| store: read-scorecard! always nil | killed (unit) |
| lib: scorecard path uses `/` not `__` | killed (unit) |
| lib: scorecard path drops `scorecards/` prefix | killed (unit) |

**5/5 killed, 0 survived.** The store always-nil mutant initially survived a
naïve `(when (fs/exists? p)` replace (that anchor hits
`read-certification-report!` first) and the CLI suite's `set -e` abort on a
refuse-exit before an explicit FAIL. Closed both gaps this pass:

- `model_steward_test_runner.bb` now loads the store and asserts
  `read-scorecard!` against a temp dir (present → map with overall/entries;
  absent → nil).
- `test_model_steward_cli.sh` case 05 captures certify's exit code explicitly
  so a planted-scorecard refuse is a loud FAIL, not a silent `set -e` abort.

## Verification (fresh this pass)

| check | result |
|---|---|
| `run_acceptance.sh` BL-1079 feature | 5/5 |
| `model_steward_test_runner.bb` | ALL PASS |
| `test_model_steward_cli.sh` | ALL PASS (incl. 05 / 05b) |
| `bl1079_cursor_certification_gate_property_runner.bb` | ALL PASS |
| `bl1079_provider_agent_allowlist_property_runner.bb` | ALL PASS |
| standing guards `extension/test/*Guard*.test.js` (non-property) | 125/125 |

CRAP / DRY: not applicable (`.bb` + `specs/pipeline/steps/`, not
`extension/src/*.ts`).

## Orphans

No leftover `mutationWorker` / `gherkin-mutator` / `stryker` processes.

## Outstanding (not this ticket)

BL-113 soft Gherkin mutation of
`specs/features/BL-1079-a-cursor-identity-can-be-steward-certified.feature`
deferred under BL-149 cooldown — coordinator sequences the quiet re-pass.

## Verdict: PASS — forwarding to documenter.

By hardener (Cursor thin-pass).
