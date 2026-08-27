# Run BL-528 claim-progress acceptance via APS handlers (BL-612)

BL-528's claim-without-progress auto-heal shipped with shell coverage
(`swarmforge/scripts/test/test_claim_progress_sweep.sh`) but no APS step
handlers, so `run_acceptance.sh` on
`specs/features/BL-528-claim-without-progress-auto-heal.feature` threw
"no step handler". BL-612 wires those handlers only — it does **not** change
claim-progress thresholds, probe grace, or the halt path.

## What landed

- Module: `specs/pipeline/steps/bl612ClaimProgressAcceptanceStepHandlersSteps.js`
  (registered in `specs/pipeline/steps/index.js`).
- Handlers call the shipped Babashka seams in
  `swarmforge/scripts/claim_progress_lib.bb` and the
  `clear-claim-progress!` leg in `chase_sweep_lib.bb` via `bb -e` — they do
  **not** re-derive the idle ladder in JavaScript.
- Scenario Outline placeholders (`<evidence>`, `<action>`, `<state>`,
  `<role>`, `<age>`, `<verdict>`) use explicit `KNOWN_*` allow-lists.

## Run the acceptance gate

From the repo root:

```bash
specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-528-claim-without-progress-auto-heal.feature
```

Expect every scenario green with no "no step handler" throw. Shell suite
`swarmforge/scripts/test/test_claim_progress_sweep.sh` must still pass
unchanged.

## Related

- **BL-528** — task-mode claim-idle escalation (nudge → bounce → halt).
- **BL-678** — batch-mode claim-progress sidecar (separate ladder).
- Feature: `specs/features/BL-528-claim-without-progress-auto-heal.feature`.

Acceptance path for this ticket is that same BL-528 feature file (handlers
make it executable).
