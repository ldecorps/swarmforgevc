# BL-1391 — CLEANER PASS (bounce rework), 2026-09-04

NONE. No defect found; no cleanup change made.

## What changed

Coder's rework fixes the two intermittent-flake shapes architect bounced
(`52af2855b8`):

- **Shape 1** (seed-push race): the fixture's `git clone -b main` raced
  the first push to a fresh bare repo whose HEAD still pointed at the
  init default. HEAD is now pinned at creation, and the clone waits on a
  bounded `ls-remote` instead of racing it.
- **Shape 2** ("the resolver committed past a refusing guard chain"):
  root-caused to a REAL, separate defect coder found by running a REAL
  `handoffd.bb` tick — this ticket's e2e is the only test in the tree
  that does. Two forward-reference bugs from BL-1392's own commit
  (`read-json` invented, doesn't exist in `handoffd.bb`; the
  `cron-heartbeat-sweep!` defined ABOVE `send-push-alarm-email!`, its own
  dependency) meant the cron watchdog threw on its first real firing and
  was silently swallowed by its own `try/catch` as `cron-heartbeat-error`
  — a dead-cron detector that could never fire, exactly the failure
  BL-1392 exists to end, invisible to a grep-based registration check
  since SCI resolves a `defn` body's vars only when it RUNS, not when it
  loads.
- The fixture also migrated onto `test/lib/fixture_isolation.sh` (no
  blind prefix sweep), its acceptance handler now memoizes the e2e run
  at module scope, and the scripts tree under test is one symlinked copy
  per run rather than a full recursive copy.

## What was checked

- Re-ran `test_bl1391_bookkeeping_conflict.sh` THREE times (deliberately,
  given the bounce was for a ~1-in-6 intermittent flake): 3/3 clean runs,
  no failures.
- `master_main_reconcile_lib_test_runner.bb` — re-ran: ALL TESTS PASS.
- `bl1391_bookkeeping_conflict_property_runner.bb` — re-ran: ALL
  PROPERTIES HOLD over 515 constructed cases.
- Verified BL-1392's actual defect fix directly: `cron-heartbeat-state`
  no longer calls a nonexistent `read-json`, uses a real
  `json/parse-string` read with its own try/catch; `send-push-alarm-email!`
  (line 2792) is now defined BEFORE `cron-heartbeat-sweep!` (line 2850),
  with a comment recording why the ordering is load-bearing.
- Re-ran `cron_heartbeat_lib_test_runner.bb` and
  `test_bl1392_dead_cron_never_silent.sh` for regression: both still
  16/16 and ALL PASS respectively — the fix did not disturb BL-1392's
  own suite.
- `required_wiring` and suite-manifest registration both confirmed
  unaffected/still correct.
- `jscpd` over the changed step handler and the two touched `.bb` files:
  0 clones.
- `mutation-site-count.js` on the step handler: 164 sites (`over` 100).
  Reviewed and declined to split, same reasoning as every other ticket
  this session: one cohesive single-feature handler.
- TypeScript compiles clean; the handler discovers via BL-1371's
  registry.

This is the bounce rework, not a new bounce; `bounce_count` context
unchanged by this pass. Forwarding unchanged to architect.

By cleaner.
