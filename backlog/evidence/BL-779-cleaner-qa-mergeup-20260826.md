# BL-779 — cleaner QA merge-up — 20260826

- QA note: merge branch up to `2daa07f7f` (BL-779 QA pass on origin/main).
- Merged `origin/main` into `swarmforge-cleaner` (`596c3a511`).
- Restored stacked sibling slices (BL-980/784/780) dropped by merge from
  pre-merge tip `4f81954d4`; re-added `bl980` step require in index.js.
- Verified: `flow_watchdog_test_runner.bb`, `bl980RecentlyClosedElapsed.test.js`
  — PASS.

By cleaner.
