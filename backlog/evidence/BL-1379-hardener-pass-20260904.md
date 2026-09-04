# BL-1379 — hardener pass, 2026-09-04

Merged architect commit `b5c4dbd6c4` (D1 fixed and re-verified —
`backlog/evidence/BL-1379-architect-pass2-20260904.md`). Independently
re-ran every gate rather than trusting the evidence trail.

## Checks re-run, all independently

- `bb swarmforge/scripts/test/expedite_lib_test_runner.bb` — ALL PASS.
- `bb swarmforge/scripts/test/expedite_lib_property_runner.bb` — ALL
  PROPERTIES HOLD, 500 runs each; generator coverage confirmed non-degenerate
  (stopped=166/live=334, bounce-repeat=251/no-repeat=249).
- `bash swarmforge/scripts/test/test_handoffd_expedite_park_reversal_wiring.sh`
  — ALL PASS (5/5), spawning the REAL daemon against a real fixture root:
  the sweep reaches `expedite_cli.bb`'s `unpark` subcommand; the restored
  ticket is blocked pending an Article 3.6 freshness check naming its
  expedition; a settled run drops out of the sweep; a human's hold/ ticket
  is untouched.
- `bash swarmforge/scripts/test/test_expedite_cli.sh` — ALL PASS,
  unaffected by this parcel.
- `specs/pipeline/scripts/run_acceptance.sh` on the BL-1379 feature —
  9/9 PASS.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- No `required_wiring:` on this ticket, confirmed deliberate (the ticket's
  own description names the call site as the daemon sweep registration
  itself, which the wiring test above already proves reachable from a
  real, live daemon — a restated literal anchor would prove nothing the
  wiring test doesn't already).
- BL-567's superseded scenario 18 confirmed RETIRED (deleted, not
  reworded) in `specs/features/BL-567-expeditor-offline-single-ticket-pipeline.feature`
  — matches Article 3.6's "retires, never rewords" rule. Moving the doc
  page to `docs/deprecated/` is the documenter's step next.

## BL-149 cooldown gate (all three changed production files)

`handoffd.bb`, `expedite_cli.bb`, `expedite_lib.bb` — all DECISION:
skip-cooldown (still inside the 3-day window, this ticket's own coder
commits plus today's bounce-fix). No additional hand-authored sweep on
top of the coder/architect's own bounce cycle; the property runner's
500-run non-degenerate generator coverage across both stopped/live and
bounce-repeat/no-repeat axes substitutes for the pure-lib decision
functions the daemon adapters call.

## BL-113 Gherkin mutation (the one Scenario Outline in the feature)

Ran `run_gherkin_mutation.sh` soft over the BL-1379 feature against
`specs/pipeline/steps/index.js`. 2/2 mutants killed, 0 survived, 0 errors.
Manifest stamped.

## CRAP / DRY

Both `npm run crap` and `npm run dry` are scoped to `extension/src/**`.
This parcel touches no file under `extension/src` — CRAP/DRY N/A.

## Result

No defect found. No orphaned test/mutation processes left behind
(confirmed via `pgrep`). Forwarding to documenter.

By hardender.
