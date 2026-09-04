# BL-1391 — architect re-review (bounce rework), 2026-09-04

Reviewed coder's rework merged in via cleaner `d119daac0e`.

## D1 verified fixed — non-flakiness measured, not merely claimed

The bounce's two failure shapes are both addressed:
- Shape 1 (fixture `git clone -b main` racing `push -u origin main`):
  fixed by pinning the bare repo's HEAD at creation and waiting on a
  bounded `ls-remote --heads` before cloning.
- Shape 2 (fixture-safety pattern retired by the constitution): the
  suite now sources the same `fixture_isolation.sh` this session already
  reviewed for BL-1392/BL-1363/BL-1390.

I ran the standalone e2e **6 more times** this pass (all clean, on top
of the coder's own reported 12/12) and the acceptance path **3 times**
(6/6 each time) — combined with the coder's own count, that is 19+
consecutive clean runs since the fix, against the 3-failures-in-17-runs
rate I measured before the bounce.

## A serious cross-ticket defect found and fixed as a byproduct — verified directly

BL-1391's e2e is the only test that runs a real `handoffd.bb` tick, and
running it against the daemon surfaced two forward-reference bugs in
BL-1392's own `cron-heartbeat-sweep!` (a nonexistent `read-json` function
invented by the coder, and a reference to `send-push-alarm-email!`
defined 600 lines below the sweep) — both silently swallowed by the
sweep's own `try/catch`, meaning the dead-cron watchdog BL-1392 exists to
build could never actually fire. I read this fix directly rather than
trusting the account:
- `cron-heartbeat-state` now uses `fs/exists?` + `json/parse-string`
  (both real, existing functions), wrapped in try/catch.
- The whole sweep is now positioned after `send-push-alarm-email!`'s
  definition, with a comment explaining why placement is load-bearing in
  this file (SCI resolves a defn body's vars when it RUNS, not when it's
  defined).
- Confirmed the fix is genuine by running BL-1391's own e2e 6 times (it
  exercises a real daemon tick that would throw `cron-heartbeat-error`
  if either bug were still present) — all 6 clean.
- BL-1392's own test still cannot see this class of defect (registration
  by grep, never executing the sweep) — exactly the gap the coder's
  evidence names; BL-1392's holder (hardener, currently) is being
  notified by note per the coder's account, which I did not verify
  further since it is outside this ticket's own scope.

## Re-verified independently, not trusted from evidence

- `master_main_reconcile_lib_test_runner.bb` — ALL TESTS PASS.
- `bl1391_bookkeeping_conflict_property_runner.bb` — ALL PROPERTIES HOLD
  over 515 constructed cases.
- `run_acceptance.sh` on the BL-1391 feature — 6/6, three times.
- Dependency gate, `required_wiring` anchors, feature-handler
  registration — all clean.

## Merge note

This merge also touched BL-1363's step handler/test/manifest (both
branches had independently added the same fixture-safety retrofit and
BL-1363's own memoization fix, from earlier cross-cutting work) — merged
by taking the more complete side and re-verifying BL-1363's own suite
still passes (20/20, unaffected).

## Verdict

COMPLIANT. D1 fixed and measured non-flaky; the byproduct BL-1392 fix
independently confirmed correct. Forwarding to hardener.
