# BL-1154 hardener pass — build-stale must not burn crash give-up budget — 20260826

**Architect tip:** `fce34516f7`
**Task:** `BL-1154-build-stale-restarts-not-crash-giveup-budget`

## Gates

| Gate | Result |
|------|--------|
| integration `test_bl1154_build_stale_not_crash_giveup_budget.sh` | ALL PASS |
| property `bl1154_build_stale_giveup_budget_property_runner.bb` | ALL TESTS PASSED |
| unit `front_desk_supervisor_lib_test_runner.bb` (BL-1154 section) | ALL PASS |
| APS BL-1154 | 2/2 |
| Gherkin mutation | `inapplicable` (no Scenario Outline; manifest recorded) |
| Surgical `bl1154_build_stale_giveup_budget_mutation_sweep.sh` | killed=5 survived=0 skipped=0 |
| BL-149 cooldown | `skip-cooldown` on `front_desk_supervisor_lib.bb` (0.00 days) |

## Hardening delta

- Lib tests: assert voluntary restart clears `:crashed-at-ms`; half-backoff must not
  restart early — locks `(max 1 (:attempts entry))` floor on stale-build path.
- Property runner: `:crashed-at-ms nil` after voluntary restart.
- Hand-authored surgical sweep over `voluntary-build-stale-started-entry` and
  `"stale-build"` clause (attempt preservation, crash-path separation, backoff floor).

## Standing guards

- `tmpDirMigrationGuard` / related tree scans: pre-existing mkdtemp debt on
  `topicThreadKind*.test.js` etc. (present on `origin/main`); BL-1154 did not
  introduce violations — `residentSpyUiHtml.test.js` has no mkdtemp.

Tip purity: no mutation caches staged.

By hardender.
