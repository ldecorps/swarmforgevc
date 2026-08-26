# BL-779 — architect bounce (rematch) — 20260826

- Reviewed cleaner tip `bf1bbc0b07` (detached; 65 paths vs `origin/main`).
- Prior bounce required BL-779-only re-cut; rematch is **worse**, not remediated.

## Inventory (one bounce)

### D1 — behavior: land diff deletes BL-589 and bundles BL-784/980/593 — blamed: cleaner

**Evidence**

- vs `origin/main`: **deletes** `backlog/done/M8/BL-589-...` and
  `backlog/topics/BL-589.json` (un-lands QA-approved BL-589).
- Adds BL-784 daemon-freshness stack (15 supervisor/conf paths), BL-980 tests/steps,
  BL-593 mutation telemetry, BL-668/736 features — not BL-779 scope.
- Coder `51370dfef9` claimed BL-779-only but still 31 paths (BL-589 active yaml
  vs main done). Cleaner `bf1bbc0b07` layered BL-784 restore + more siblings.

**Required remediation**

- Re-cut from current `origin/main`; land diff must be BL-779-only (~11 paths:
  `flow_watchdog_lib.bb`, `babysitterd_sweep_lib.bb`, `backlog_depth_lib.bb`,
  `babysitter_check.bb`, tests, feature, `bl779` steps, `index.js`).
- **Preserve** `backlog/done/M8/BL-589-...` on main — do not delete or move to active.
- Verify: `git diff --name-only origin/main..TIP | rg 'BL-589|BL-784|BL-980|BL-593|daemon_log_freshness'` — empty.

## What is otherwise sound (BL-779 surface)

| Gate | Result |
|---|---|
| `test_babysitter_check.sh` | ALL PASS |
| `flow_watchdog_test_runner.bb` | ALL PASS |
| `babysitterd_sweep_lib_test_runner.bb` | ok |

Pause-aware alarm text intact on inspected paths.

## Verdict: BOUNCE — do not forward to hardender.

By architect.
