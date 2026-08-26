# BL-557 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `265615f523` (graduate Model Steward to
coordinator-assignable role; `known_limitations` on registry; `compat-docs`
projection; no always-on pane) into `swarmforge-cleaner` via
`git merge --no-ff`. Ancestry: `git merge-base --is-ancestor 265615f523 HEAD`.

## Checks run

1. **Babashka unit** — `bb swarmforge/scripts/test/model_steward_test_runner.bb`:
   ALL PASS.
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-557-model-steward-slice3-role-and-compat-docs.feature`:
   7/7 pass.

## Cleanup performed

- `bl557ModelStewardSlice3Steps.js`: extracted `limitationFor` so Outline
  re-register uses one CLI path.
- `model_steward_cli.bb`: named `parse-limitations-flag` (blank-safe `;`
  split); defined before `run-register` for SCI analysis order.

## Findings beyond that

NONE. Role prompt pin (on-demand only) and registry→docs projection stay
intact; no launch-surface hitchhikers.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-557-model-steward-slice3-role-and-compat-docs`.

By cleaner.
