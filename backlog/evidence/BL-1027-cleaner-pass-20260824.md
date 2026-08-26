# BL-1027 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `7689f4d731` (mint-time hygiene refuses dangling
`acceptance:` pointers via `applicable?` + working-tree probe) into
`swarmforge-cleaner` via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor 7689f4d731 HEAD`.

Parcel surface:
- `swarmforge/scripts/backlog_hygiene_lib.bb`
- `swarmforge/scripts/backlog_epic_milestone_audit.bb`
- `swarmforge/scripts/specifier_backlog_hygiene_gate.bb`
- `swarmforge/scripts/test/backlog_hygiene_lib_test_runner.bb`
- `swarmforge/scripts/test/bl1027_dangling_acceptance_property_runner.bb`
- `specs/pipeline/steps/bl1027MintTimeDanglingAcceptanceSteps.js`
- `specs/pipeline/steps/index.js` (register wiring)
- ticket paused → active

## Checks run

1. **Babashka unit** —
   `bb swarmforge/scripts/test/backlog_hygiene_lib_test_runner.bb`: all passed
   (including new dangling-acceptance cases).
2. **Property runner** —
   `bb swarmforge/scripts/test/bl1027_dangling_acceptance_property_runner.bb`:
   all passed.
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1027-mint-time-gate-refuses-a-dangling-acceptance-pointer.feature`:
   9/9 pass. Required wiring: steps in `index.js`.

## Cleanup performed

- Restored `violations-for-file` as the audit entry point with an optional
  `repo-root` arity so the epic/milestone audit does not inline `slurp` /
  skip id extraction.
- Steps: declaration fixtures via lookup map; `KNOWN_DECLARATIONS` derived
  from that map.

## Findings beyond that

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1027-mint-time-gate-refuses-a-dangling-acceptance-pointer`.

By cleaner.
