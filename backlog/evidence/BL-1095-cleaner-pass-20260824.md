# BL-1095 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `a600d4307d` (retire `type: bug` from Article 3.2.4
expedite lane; mint hygiene refuses the retired type) into
`swarmforge-cleaner` via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor a600d4307d HEAD`.

Parcel surface:
- `swarmforge/scripts/promotion_gates_lib.bb`
- `swarmforge/scripts/backlog_hygiene_lib.bb`
- `swarmforge/scripts/test/backlog_hygiene_lib_test_runner.bb`
- `swarmforge/scripts/test/promotion_gates_lib_test_runner.bb`
- `swarmforge/scripts/test/promotion_gates_lib_property_runner.bb`
- `specs/pipeline/steps/bl1095RetireExpediteBugTypeSteps.js`
- `specs/pipeline/steps/index.js` (register wiring)
- ticket paused → active

## Checks run

1. **Babashka unit** —
   `bb swarmforge/scripts/test/backlog_hygiene_lib_test_runner.bb`: all passed
   (including retired-ticket-type cases).
   `bb swarmforge/scripts/test/promotion_gates_lib_test_runner.bb`: ALL PASS.
2. **Property runner** —
   `bb swarmforge/scripts/test/promotion_gates_lib_property_runner.bb`:
   ALL PROPERTIES HOLD.
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1095-retire-the-expedite-lanes-legacy-bug-type.feature`:
   9/9 pass. Required wiring: mint refuse via `violations-for-text`.
4. **Open-corpus audit** — `bb backlog_epic_milestone_audit.bb`: ok
   (zero open `type: bug` tickets).

## Cleanup performed

- Named `:retired-ticket-type` in `backlog_epic_milestone_audit.bb` so a
  future offender cannot fail `all-clean?` without a printed reason
  (same posture as BL-922/BL-1027 kinds).
- Extended the specifier hygiene gate FAIL banner to mention retired
  `type: bug`.

## Findings beyond that

NONE. Inventory NONE. (Constitution Article 3.2.4 prose remains a
specifier/BL-798 deliverable per ticket notes — not in this tip.)

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1095-retire-the-expedite-lanes-legacy-bug-type`.

By cleaner.
