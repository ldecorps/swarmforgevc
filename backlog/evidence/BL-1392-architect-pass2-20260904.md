# BL-1392 — architect re-review (D1 fix), 2026-09-04

Reviewed coder's rework merged in via cleaner `f2171805cc`, which also
retrofits the same fixture-safety fix into BL-1363's and BL-1390's own
e2e suites via a new shared `swarmforge/scripts/test/lib/fixture_isolation.sh`.

## D1 verified fixed

Read `fixture_isolation.sh` in full. It implements all four elements the
amended engineering article now requires: an owner-pid stamp per fixture
root, reaping that only removes a root whose owner is confirmed dead
(`kill -0` check) or unstamped-and-past-an-age-bound (never a blind
prefix `rm`), a `flock`-based lock so at most one instance runs (with a
clean `SUITE_BUSY` exit for a second instance, never a collision), a
wall-clock bound via a self-re-exec under `timeout`, and an invoker log
line. No prefix `rm -rf` remains anywhere in the three retrofitted
scripts (`test_bl1392_dead_cron_never_silent.sh`,
`test_bl1363_close_ticket.sh`, `test_bl1390_post_commit_push.sh`) —
confirmed by grep.

## Independently re-verified, not trusted from evidence

- `cron_heartbeat_lib_test_runner.bb`, `bl1392_cron_heartbeat_property_runner.bb`
  — both green, unaffected (production logic untouched by this rework).
- `test_bl1392_dead_cron_never_silent.sh` — 5 sequential clean runs, plus
  **3 genuinely concurrent invocations** (backgrounded simultaneously):
  all three completed `ALL PASS` with no fixture destroyed, confirming
  the lock correctly serializes access rather than colliding.
- The two retrofitted suites (`test_bl1363_close_ticket.sh`,
  `test_bl1390_post_commit_push.sh`) — both still green.
- Acceptance on all three affected features — BL-1392 6/6, BL-1363 5/5,
  BL-1390 7/7 (the amended feature's new scenario 07 included) — all
  markedly faster than before thanks to the module-scope memoization fix
  (the "multiplier half" of the incident: an acceptance handler used to
  re-run the whole e2e once per scenario).
- `check_feature_handler_registration.sh`, dependency gate — both clean.

## One dormant design note, not a blocker

`fixture_isolation_begin`'s wall-clock bound re-execs via `exec timeout
"$bound" bash "$0" "$@"` — but the `"$@"` there is the FUNCTION's own
positional args (the fixture prefix and bound value passed to
`fixture_isolation_begin`), not the CALLING SCRIPT's original command-line
arguments, which are never threaded through. Verified directly with a
minimal repro: a script invoked as `bash script.sh original-arg1
original-arg2` sees its own `$@` silently replaced by the fixture
prefix/bound pair after the re-exec. This is dormant today — none of the
three current callers take positional arguments — but it is a real gap
in a piece of shared, explicitly-reusable safety infrastructure ("what
every suite sourcing this file gets"): the first FUTURE e2e script built
on this library that does take its own CLI arguments would have them
silently corrupted. Not bouncing over it since it violates none of this
parcel's own declared invariants and affects no current caller, but
recording it so the next adopter (or the specifier, when this pattern is
proposed more broadly) knows to thread the original argv through rather
than rediscover this the hard way.

## Verdict

COMPLIANT. D1 fixed and independently confirmed, including under real
concurrency. Forwarding to hardener.
