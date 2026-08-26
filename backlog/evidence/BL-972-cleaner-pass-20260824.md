# BL-972 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `2c7d557354` (pre-QA ancestry blocks on path overlap with
parcel evidence; subject-only → warning; abandoned_commits still exempts)
into `swarmforge-cleaner` via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor 2c7d557354 HEAD`.

## Checks run

1. **Babashka unit** — `bb swarmforge/scripts/test/pre_qa_gate_lib_test_runner.bb`:
   ALL PASS.
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-972-pre-qa-gate-blocks-on-evidence-not-subject-mentions.feature`:
   3/3 pass.

## Cleanup performed

- `pre_qa_gate_gather_lib.bb`: shared `git-name-only-paths` for
  `commit-touched-paths` and parcel diff; `merge-base-with-main` tries
  `main` / `origin/main` via one `some` loop.

## Findings beyond that

NONE. Lib helpers (`paths-overlap?`, `stranded-ticket-commit?`,
`ancestry-verdict`) already keep evaluate CC low. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-972-pre-qa-gate-blocks-on-evidence-not-subject-mentions`.

By cleaner.
