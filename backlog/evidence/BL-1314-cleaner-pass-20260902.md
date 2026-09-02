# BL-1314 — cleaner pass (2026-09-02)

Stage: cleaner. Received commit: `5a45f95bc1` (coder).

## Checklist run this pass

- `npm run compile` (extension/) — clean.
- `npx jscpd` over the three new/changed files (`invariant2_qa_definition_lib.sh`,
  `bl1314InvariantTwoQaQuestionSteps.js`,
  `bl1314InvariantTwoQaQuestionInvariants.property.test.js`),
  `--min-lines 15 --min-tokens 60` — 0 clones. No DRY finding.
- Module structure / architecture review — the new predicate lives in its own
  file (`invariant2_qa_definition_lib.sh`), sourced by the standing test
  rather than inlined; no boundary or separation-of-concerns issue found.
- Mutation-site count / CRAP / Stryker — not applicable: the one production
  path changed is a bash file, outside the TypeScript Stryker scope
  (`out/**/*.js`); its own gate is `test_invariant2_qa_definition_lib.sh`.
- `bash swarmforge/scripts/test/test_invariant2_qa_definition_lib.sh` — 9/9
  `ALL PASS`.
- `bash swarmforge/scripts/test/test_pipeline_code_on_main_guard.sh` — exit 0,
  every case including `BL-925 invariant2-one-shared-definition`.
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1314-invariant-two-assertion-scoped-to-the-qa-question.feature`
  — 6/6 pass.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1314InvariantTwoQaQuestionInvariants.property.test.js` — 3/3 pass.

## Verdict: NONE

No defect found. No cleanup change made — the coder's parcel is already DRY,
correctly structured (extracted lib over inline grep, matching the ticket's
own reasoning), and fully covered. Forwarding as-is.

## Inventory travel note

No inbound bounce items carried into this parcel.
