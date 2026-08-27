# BL-1154 — architect pass — 20260826

- merge_and_process cleaner tip `b2af94b223` (clean merge).
- Ticket: voluntary build-stale restarts must not burn the crash give-up
  attempt budget; true crash loops still reach give-up.

## Architecture / boundaries

- Pure policy in `front_desk_supervisor_lib.bb`: new `"stale-build"` restart
  path uses `voluntary-build-stale-started-entry` (preserves `:attempts`) vs
  crash `"waiting"`/`"stalled"` path using `started-entry` (increments
  `:attempts` and feeds `decide-restart-action`). Backoff spacing shared; give-up
  budget read only on crash path. No extension production surface; Babashka
  supervisor layer only.
- Dependency gate (`test/residentSpyUiHtml.test.js`): PASSED — merge-conflict
  resolution only; no forbidden edges.
- Co-change report: expected historical coupling on resident spy UI test file;
  no new logical coupling introduced by BL-1154 paths.

## Required wiring

- APS `bl1154BuildStaleNotCrashGiveupBudgetSteps` registered in index; scenarios
  bind to lib runner, acceptance shell, and property runner.

## Invariants

1. Voluntary build-stale never alone exhausts crash budget: property runner P1 +
   lib tests `bl1154:` section; attempts unchanged across `"stale-build"` cycle.
2. Crash loop still reaches give-up: property runner P2 + lib test at attempt cap.

Both property encodings exist, non-vacuous (P1 fails if `started-entry` replaces
`voluntary-build-stale-started-entry`).

## Property-testing pass (undeclared TS modules)

- No touched TypeScript pure production modules; Babashka property runner covers
  the slice. No new `*.property.test.js` added.

## Verification

- `front_desk_supervisor_lib_test_runner.bb`: ALL PASS.
- `bl1154_build_stale_giveup_budget_property_runner.bb`: ALL TESTS PASSED.
- `test_bl1154_build_stale_not_crash_giveup_budget.sh`: ALL CHECKS PASSED.
- No prior QA bounce for BL-1154 on main.

Pass → hardender.

By architect.
