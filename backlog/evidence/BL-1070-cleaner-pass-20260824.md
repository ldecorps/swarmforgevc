# BL-1070 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `342107cc4b` (pane liveness walks all descendants for
the agent marker; RC check emits UNAVAILABLE when liveness is unmet) into
`swarmforge-cleaner` via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor 342107cc4b HEAD`.

Parcel surface:
- `swarmforge/scripts/agent_process_marker_lib.bb`
- `swarmforge/scripts/babysitter_check.bb`
- `swarmforge/scripts/babysitterd_sweep_lib.bb`
- `swarmforge/scripts/test/agent_process_marker_lib_test_runner.bb`
- `swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb`
- `specs/pipeline/steps/bl1070PaneLivenessDepthSteps.js`
- `specs/pipeline/steps/index.js` (register wiring)
- ticket paused → active

## Checks run

1. **Babashka unit** —
   `bb swarmforge/scripts/test/agent_process_marker_lib_test_runner.bb`: OK.
   `bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb`: ok.
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1070-pane-liveness-misses-a-claude-below-the-first-generation.feature`:
   9/9 pass. Required wiring: steps in `index.js`.

## Cleanup performed

- Steps: depth fixtures via lookup map; `KNOWN_DEPTHS` derived from it.

## Findings beyond that

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1070-pane-liveness-misses-a-claude-below-the-first-generation`.

By cleaner.
