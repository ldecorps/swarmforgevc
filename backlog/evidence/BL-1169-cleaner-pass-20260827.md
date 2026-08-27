# BL-1169 cleaner pass — 2026-08-27

## Inbound

Cherry-picked coder `1dee3fc68f` tip-pure (7 paths). Conflict in
`specs/pipeline/steps/index.js` resolved keeping both BL-1169 and BL-1173
requires. Added feature + active ticket from `main` for acceptance.

## Checks run

1. **Babashka unit** — `babysitterd_sweep_lib_test_runner.bb`: ok.
2. **Babashka properties** — `babysitterd_sweep_lib_property_runner.bb`: ok.
3. **Gherkin acceptance** —
   `specs/features/BL-1169-babysitter-half-launch-starvation-auto-repair.feature`:
   4/4 pass.

## Cleanup performed

NONE. Sweep lib changes stay focused on half-launch / starved repair paths.

## Findings

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1169-babysitter-half-launch-starvation-auto-repair`.

By cleaner.
