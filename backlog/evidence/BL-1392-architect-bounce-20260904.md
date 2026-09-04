# BL-1392 — architect review, 2026-09-04: BOUNCE

Reviewed coder commit `69051ff493` (merged in via cleaner `a1efa2386e`).

## Checks that passed

- Dependency gate on `bl1392DeadCronNeverSilentSteps.js`: PASSED.
- `required_wiring`: both anchors present — `CRON_DAEMON_DOWN` in
  `install_swarmforge_crons.sh`, `cron-heartbeat-stale` in `handoffd.bb`,
  and `cron-heartbeat-sweep!` genuinely registered in the live poll loop
  (`run-sweep! "cron-heartbeat" #(cron-heartbeat-sweep!)`, confirmed by
  reading the wiring, not just grepping the string).
- `cron_heartbeat_lib_test_runner.bb` — ALL TESTS PASSED, re-run.
- `bl1392_cron_heartbeat_property_runner.bb` — ALL PROPERTIES HOLD over
  30 constructed cases, re-run.
- `test_bl1392_dead_cron_never_silent.sh` — 4/4 clean re-runs, and I read
  it in full: the invariant 3 checks (no host config written, `/etc/wsl.conf`
  untouched) and the escalate-once/re-arm sequence are correctly asserted.
- Acceptance not yet independently re-run — the fixture-safety finding
  below is severe enough to bounce before spending more time on it.

## D1 — the e2e fixture uses the exact sweep pattern the constitution retired TODAY, in the same commit range this parcel is riding with (correctness/reliability, class: behavior)

`swarmforge/scripts/test/test_bl1392_dead_cron_never_silent.sh` opens:

```bash
PREFIX="bl1392-cron-"
...
rm -rf "${TMPDIR:-/tmp}/${PREFIX}"* 2>/dev/null || true
WORK="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}XXXXXX")" || exit 1
```

This is precisely the pattern the constitution's engineering-detailed
article was amended to retire **just minutes before this merge**
(`13f5834285`, "BL-1390: second incident - 1156 concurrent copies of the
e2e"), which I merged into this worktree as part of this same task per
the STALE_REFERENCE_ELABORATION gate:

> A prefix sweep before a run reaps only what no live run owns (BL-1385,
> BL-1390, 2026-09-04). BL-971's "sweep by prefix BEFORE the run too" is
> right for one runner at a time. `check_handler_module_graph.sh` ... and
> `test_bl1390_post_commit_push.sh` ... both did a blind `rm -rf
> <prefix>*` at startup; two overlapping guard runs deleted each other's
> tree, and 1156 concurrent copies of the e2e exhausted a host. Rule:
> record the owner pid inside each fixture root; reap only roots whose pid
> is dead or whose age exceeds a bound; anything that can run concurrently
> also takes a lock so at most one instance runs, bounds its wall clock,
> and logs the process chain that invoked it.

This test script is spawned the same way both incident scripts were —
via `spawnSync` in its own acceptance step handler
(`bl1392DeadCronNeverSilentSteps.js:43`), registered as **standing** in
`suite-manifest.tsv`, and therefore reachable from mutation/acceptance
harnesses across worktrees exactly like `check_handler_module_graph.sh`
and `test_bl1390_post_commit_push.sh` were. It has NONE of the four
required elements: no owner-pid file, no dead-only reaping, no
concurrency lock, no wall-clock bound, no invoker-chain logging.

**Not a blame finding.** Read the timestamps: the coder's commit adding
this file is `2026-09-04 18:35:00`, ten seconds before the specifier's
amendment commit (`18:35:10`) that retired the pattern. This parcel could
not have known the rule at the moment it was written — the same shape as
this session's own BL-1387 scenario-06 timing gap. But the rule now
stands, the vulnerability is real and concrete (a third incident of this
exact class would not be a surprise), and Article 4.4's complete-review
duty means I record what I see regardless of when it became visible.

## Fix, not mine to write

Apply the four elements the amended rule now requires to this fixture's
own prefix sweep: an owner-pid file written immediately after `mktemp -d`
(matching the shape `check_handler_module_graph.sh`'s `reap_dead_roots`
already uses for the pid-liveness half, per this session's own BL-1385
review), reaping scoped to dead-owner or aged-out roots only, a
concurrency lock so at most one instance of this specific e2e runs at a
time, a bounded wall clock, and a log line naming the invoking process
chain. The full remedy shape is being worked out for BL-1390 itself right
now (its own ticket amendment, same commit); coordinating with whatever
that lands as would avoid two independent answers to the same question.

## Verdict

NOT COMPLIANT. Bouncing to coder for the fixture-safety fix; the
production code itself (installer probe, heartbeat lib, daemon wiring)
reads correctly and is not what's being bounced.
