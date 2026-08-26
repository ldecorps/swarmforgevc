# BL-1086 — hardener pass

Received from architect as `merge_and_process architect 70bcf7a074` (COMPLIANT
verdict; no defect found, no coverage gap flagged). Babashka/shell surface
(BL-472): no mutation/CRAP/DRY tooling wired for `.bb`/`.sh` — gated by its
own unit/property/acceptance suites, which is what this pass exercises.

## BL-113 gherkin mutation on scenario 03 — real gap, closed

The acceptance feature's only `Scenario Outline` (`<ref>` moving forces a
fresh gather, 3 rows) survived 3/3 on first run. The step handler for `the
"<ref>" tip moves` DOES branch on the Examples value directly (a case
statement: `main` / `swarmforge-QA` / else-as-`origin/main`), but the only
downstream `Then` step — `the approval predicate is invoked once` — asserts
nothing more than "a re-gather happened," which is identically true whichever
of the three tips actually moved. A mutated Example value (`main` ->
`maiN`) falls through to the `else` branch, moves the WRONG ref, and the
scenario still passes because *some* tip moving still triggers exactly one
predicate call.

Fixed in `bl1086BabysitterCacheBatchSteps.js`'s `the "<ref>" tip moves` step:
records each of the three tips' git-rev-parse values before and after the
move, asserts the NAMED ref changed and the other two did not. This pins the
Outline column against the fixture's own observable git state — the same
`KNOWN_VALUES` discipline as engineering.prompt's Acceptance Pipeline rule —
rather than trusting the downstream assertion's shape to distinguish rows it
was never written to distinguish. Re-ran hard (bypassing the soft
mutation-stamp skip): 3/3 killed. Acceptance re-confirmed 8/8 unaffected.

## Fixture leak found and fixed (2 of 6 scenarios)

While re-running acceptance to verify the mutation fix, `/tmp/aps-bl1086-*`
accumulated 8 directories across two runs — 4 leaked per run. Scenarios 01,
02, 05 and 06 all end on a `Then` step that calls the module's own
`cleanup()`; scenarios **03** (all three Outline rows) and **04** end
exclusively on `the approval predicate is invoked once`, which never called
it. Every one of their `fs.mkdtempSync` fixture roots was left on disk
permanently — the general shape engineering.prompt's Test Speed And
Isolation rule and the standing hardener lesson on `mkdtempSync` cleanup
describe, here as a structural gap (no scenario-ending step ever reaching
`cleanup()`) rather than a throw-before-cleanup ordering issue.

Fixed by calling `cleanup()` from `the approval predicate is invoked once`
itself — the one step shared by every affected scenario. Confirmed
idempotent for the scenarios that already clean up in a later step (01):
`cleanup()`'s own `while (roots.length)` is a no-op once already emptied, so
no double-removal is possible. Verified with a real run:
`ls /tmp/aps-bl1086-* | wc -l` was 8 before the fix, 0 after, across a
fresh acceptance run.

## Everything else re-verified, unchanged

| check | result |
|---|---|
| BL-1086 acceptance feature | 8/8 (before and after both fixes) |
| BL-113 gherkin mutation, scenario 03 (hard) | 3/3 killed (was 0/3) |
| `bl1086_cache_and_batch_property_runner.bb` | ALL PROPERTIES HOLD (40 runs, same coverage as coder/architect evidence) |
| `bl1025_expedite_approval_property_runner.bb` | ALL PROPERTIES HOLD (32 exhaustive cases) |
| `test_babysitter_check.sh` | ALL PASS (13/13) |
| `test_is_qa_ancestor_yaml_store.sh` / `_expedite_store.sh` | ALL CHECKS PASSED |
| `test_bl1028_promotion_obeys_integrity_refusal.sh` | ALL PASS |
| `bl962_merge_adjudication_test_runner.bb` | ALL PASS |
| `babysitter_lib_test_runner.bb` / `babysitterd_sweep_lib_test_runner.bb` | ok |
| standing whole-tree guards (`extension/test/*Guard*.test.js`, non-property — a step file under `specs/pipeline/steps/` was touched) | 13 files, 125/125 |
| `test_pipeline_code_on_main_guard.sh` | fails identically at this parcel's own diff and at its parent commit (git-identity fixture gap, host-local) — re-confirmed independently, matching the coder's and architect's own re-derivations; not this parcel's to fix |
| `extension` compile | clean (no TS files touched by this ticket) |

No orphaned mutation/test processes at handoff (`pgrep -fl 'node --test|
stryker'` scoped to this worktree, clean). No fixture directories left under
`/tmp/aps-bl1086-*` after the final run.

## Handoff

Forwarded to documenter, task `BL-1086-babysitterd-rewalks-every-sha-ahead-of-qa-every-tick`.
