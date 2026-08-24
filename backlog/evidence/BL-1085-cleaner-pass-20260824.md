# BL-1085 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `6bd229f6a5` (ahead-range refusal cache + one walk per
tick via `ahead-range-facts!`) into `swarmforge-cleaner` via
`git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor 6bd229f6a5 HEAD`.

## Checks run

1. **Babashka unit** —
   `bb swarmforge/scripts/test/push_sweep_ahead_range_lib_test_runner.bb`:
   ALL TESTS PASSED.
2. **Babashka properties** —
   `bb swarmforge/scripts/test/bl1085_ahead_range_property_runner.bb`:
   ALL PROPERTIES HOLD (500 runs).
3. **Shell fixture** —
   `bash swarmforge/scripts/test/test_push_sweep_ahead_range.sh`:
   ALL BL-1085 FIXTURE CHECKS PASSED.
4. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1085-push-sweep-caches-its-refusal-and-gathers-once.feature`:
   11/11 pass.

## Cleanup performed

- `push_sweep_ahead_range_lib.bb`: extracted `incomplete-no-walk-payload` and
  `resolve-fresh!` so `resolve-ahead-range-facts!` stays a thin memo/key
  dispatch.
- `handoffd.bb`: extracted `tip-ancestry-unreadable?`; `read-ahead-range-key!`
  calls `git-ref-exists?` once; restored blank line before the BL-1098 block.

## Findings beyond that

NONE. Inventory NONE. Required wiring `ahead-range-facts!` is present and
passed into the adapters map `sweep!` is called with.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1085-push-sweep-re-proves-the-same-refusal-every-cycle`.

By cleaner.
