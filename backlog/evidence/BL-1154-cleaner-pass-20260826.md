# BL-1154 — cleaner pass — 20260826

- merge_and_process coder tip `451966dc74`; resolved
  `residentSpyUiHtml.test.js` conflict — kept BL-1046 grid-tile tests from QA
  land, dropped stale BL-1153 persistence test reverted on main.
- DRY: `bl1154BuildStaleNotCrashGiveupBudgetSteps.js` aligned with sibling
  BL-1151 pattern (`runScript` / `runBb` / `assertPassMarker` + ctx cache).
- Babashka lib change reviewed: voluntary build-stale path preserves `:attempts`
  via `voluntary-build-stale-started-entry`; crash `:waiting`/`:stalled` path
  unchanged.
- Verified: `front_desk_supervisor_lib_test_runner.bb` ALL PASS;
  `test_bl1154_build_stale_not_crash_giveup_budget.sh` ALL CHECKS PASSED;
  `bl1154_build_stale_giveup_budget_property_runner.bb` ALL TESTS PASSED;
  Vitest `residentSpyUiHtml.test.js` 12/12 after merge resolution.

By cleaner.
