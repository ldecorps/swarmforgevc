# BL-1379 — architect re-review (D1 fix), 2026-09-04

Reviewed coder's rework merged in via cleaner `33400e053e` (fast-forward).

## D1 verified fixed

The reversal's trigger is a `handoffd` sweep (`expedite-park-reversal-sweep!`),
not the land step I'd suggested — the coder's own reasoning for why is
sound and independently confirmed: the expedition's own process exits long
before its commit lands, and a hook in `land_main_publish.sh` would miss
hand-lands (exactly the route BL-1375, this ticket's own source incident,
actually landed by).

Confirmed by reading the code directly, not just the evidence:
- `swarmforge/scripts/handoffd.bb:4609-4610` registers
  `expedite-park-reversal-sweep!` in the live poll loop, in the same
  cadence block as `master-main-reconcile-sweep!` (a sweep I've already
  verified reachable in this session's BL-1386/BL-1387 reviews).
- `swarmforge/scripts/expedite_cli.bb`'s `-main` checks `(= "unpark"
  (first argv))` BEFORE the ordinary expedition argv parse, dispatching to
  a real `unpark <project-root> <run-dir>` subcommand — the sweep's actual
  call target, not a restated stub.
- The acceptance fixture (`bl1379ParkReversalCli.sh`) now runs `bb "$CLI"
  unpark "$R" "$RUN_DIR"` — the real subcommand — confirmed by reading the
  file; no longer the pure `unpark-plan` call I bounced for.

## Independently re-verified, not trusted from evidence

- `expedite_lib_test_runner.bb`, `expedite_lib_property_runner.bb` (500
  runs) — both green.
- `run_acceptance.sh` on the BL-1379 feature — 9/9.
- `test_handoffd_expedite_park_reversal_wiring.sh` — spawned the REAL
  daemon against a real fixture root; all 5 assertions pass, including
  "the real daemon reaches the sweep, and the sweep reaches
  expedite_cli.bb's unpark subcommand" and "a ticket a human placed in
  hold/ is untouched: the sweep sees only its own record" (invariant 1,
  re-confirmed at the daemon level this time, not only the pure-lib
  level). Registered in `suite-manifest.tsv` as a standing test.
- `test_expedite_cli.sh` — ALL PASS, unaffected.
- Dependency gate on `bl1379ParkReversalSteps.js` — PASSED.

## Correctness notes

- `unpark-done.json` bookkeeping (stop re-asking about a settled run on
  every tick) is a sensible addition not required by the ticket's own
  invariants but consistent with them — confirmed the wiring test asserts
  it ("a settled run is marked done and drops out of the sweep").
- The freshness-mark shadowed-binding fix (mark must name the EXPEDITION,
  not the parked ticket itself) is a real, correctly-caught bug — the
  mark would otherwise have told a coordinator to check a ticket against
  itself, which is meaningless.
- `exit!`'s single-termination-point invariant (BL-1024e) is respected on
  both paths of the new subcommand, per the coder's own note that their
  first draft broke it and `test_expedite_cli.sh` caught it — confirmed
  both `unpark-subcommand!`'s exit points route through `exit!`.

## Verdict

COMPLIANT. D1 fixed: the reversal is now reachable from a real, live
daemon sweep, proven by a daemon-level wiring test rather than only a
fixture reimplementation. Forwarding to hardener.
