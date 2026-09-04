# BL-1381 — hardener pass, 2026-09-04

Merged architect commit `3ab16ec996` (clean pass, no bounce —
`backlog/evidence/BL-1381-architect-20260904.md`). Merge carried three
conflicts against files I had already touched hardening BL-1385/BL-1387
(the coder's shared branch also rode along a BL-1385 concurrency-race
follow-up fix per the architect's own "riding along" note); all three
resolved by combining both sides' additions, verified by re-running the
combined BL-1385 acceptance suite (13/13 PASS) before proceeding to
BL-1381's own work.

## Checks re-run, all independently

- `bb -e '(load-file "swarmforge/scripts/shift_schedule_applier_lib.bb")
  (println :ok)'` — prints `:ok`, exit 0.
- `bb swarmforge/scripts/test/swarm_shift_lib_test_runner.bb` — ALL TESTS
  PASSED (the standing BL-660 red, dead since 2026-08-27, is fixed).
- `bash swarmforge/scripts/test/test_shift_schedule_applier.sh` — 9/9 PASS,
  all five BL-1381-tagged rows.
- `specs/pipeline/scripts/run_acceptance.sh` on the BL-1381 feature —
  6/6 PASS.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- `SHIFT_SCHEDULE_RECONCILE_BB` confirmed as a genuine path-override seam
  (`install_shift_schedule_cron.sh:15`), not a `*_FORCE_RESULT` bypass —
  matches the CLI-testability rule.

## BL-149 cooldown gate (both changed production files)

- `swarmforge/scripts/shift_schedule_applier_lib.bb` — DECISION: run
  (file_age_days 7.85, past the 3-day cooldown).
- `swarmforge/scripts/install_shift_schedule_cron.sh` — DECISION: run
  (file_age_days 8.74).

## Hand-authored mutation sweep (no Babashka/shell mutation tool wired —
BL-638/BL-567 fallback), both files (DECISION: run)

Wrote `swarmforge/scripts/test/bl1381_shift_schedule_mutation_sweep.sh`,
6 mutants against `test_shift_schedule_applier.sh` as the oracle:

- **2 killed**: the `bb` reconcile-failure capture (the ticket's own named
  defect: a bare command substitution under `set -e` aborting silently),
  and reverting `babashka.process` out of the `ns` form back into the
  function body (the original load-crash defect this ticket exists to
  fix).
- **4 accepted-equivalent, each verified EMPIRICALLY, not assumed**: the
  empty-output check, the parse-status check, the empty-scheduling-verdict
  check, and the Python `isinstance(d, dict)` guard. Direct invocation
  (split stdout/stderr, `$?` checked) confirmed: an empty result file
  always fails `json.load()`; a successful python parse always emits a
  non-empty `scheduling` token via `.get()`'s defaults, so `scheduling` can
  only be empty when the parse-status check already caught a failure; and
  an unguarded non-dict payload's `AttributeError` writes its traceback to
  stderr only (never stdout) and still exits 1, so the wrapper's existing
  `2>/dev/null` and parse-status check make it indistinguishable from the
  guarded `SystemExit` path. Confirmed live: with the parse-status check
  fully disabled (`|| true` in place of the `if !`/exit-1 block) against
  the real wrapper file, `test_shift_schedule_applier.sh` still passed —
  the empty-scheduling-verdict check caught it downstream with a matching
  message, which is exactly the OR-pattern the test's own "NAMES its
  cause" assertion accepts. Read together: this wrapper's four refusal
  checks are legitimate belt-and-braces defense in depth around ONE
  load-bearing observation (a successful, well-shaped parse), not four
  independently-necessary checks — real, not a test gap.

Re-ran the sweep: 2 killed, 0 survived, 4 equivalent (all reasoning
recorded inline in the sweep script per BL-234 discipline).

## BL-113 Gherkin mutation (both Scenario Outlines in the feature)

Ran `run_gherkin_mutation.sh` soft over the BL-1381 feature against
`specs/pipeline/steps/index.js`. 6/6 mutants killed (4+2), 0 survived, 0
errors. Manifest stamped.

## CRAP / DRY

Both `npm run crap` and `npm run dry` are scoped to `extension/src/**`.
This parcel touches no file under `extension/src` — CRAP/DRY N/A.

## Result

No defect found. No orphaned test/mutation processes left behind
(confirmed via `pgrep`). Forwarding to documenter.

By hardender.
