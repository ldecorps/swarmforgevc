# BL-1525 — coder rework pass, 2026-09-11 (architect bounce D1)

## Bounce addressed

`backlog/evidence/BL-1525-architect-20260911.md` D1: `specs/pipeline/steps/bl1103OneSharedBoundedRunnerSteps.js`
carried two stale assertions after ruling A moved the group-kill into
`daemon_cycle_guard_lib.bb`'s `:kill-mode :group` and changed `sh!`'s
bound-hit exit convention to `124`:

- Line 85 (`lib must carry the load-bearing group-kill`) checked
  `bounded_run_lib.bb`'s own source text for the `"kill" "-KILL" "--"`
  needle. Mirrored the check `bounded_run_lib_test_runner.bb` already
  carries: the needle now must be found in `daemon_cycle_guard_lib.bb`
  (the chokepoint), and `bounded_run_lib.bb` is asserted to have *zero*
  copies of it, plus a positive check that `run-bounded!` requests
  `:kill-mode :group`.
- Line 140 (`assert.equal(r.exit, null, ...)`) asserted the pre-BL-1525
  nil exit on a timeout. `sh!`'s bound-hit exit is now `124` (coreutils
  `timeout(1)` convention — see `daemon_cycle_guard_lib.bb`'s own
  docstrings and `bounded_run_lib.bb`'s `{:exit (:exit result) ...}`).
  Updated to `124`, matching `bounded_run_lib_test_runner.bb`'s own
  `"01: exit 124 on timeout"` case.

## Verification

- `node specs/pipeline/cli.js specs/features/BL-1103-one-shared-bounded-runner.feature`:
  3/3 scenarios pass (was 0/3 per the bounce).
- `node specs/pipeline/cli.js specs/features/BL-1525-*.feature`: 6/6 pass
  (unchanged, re-run for regression).
- `bb swarmforge/scripts/test/daemon_cycle_guard_lib_test_runner.bb`:
  `bl1031` line still gone (census `[]`); the one remaining FAIL
  (`bl1022` unresolved spawn targets) is BL-1526's scope, unchanged from
  the prior coder pass.
- `bb swarmforge/scripts/test/bounded_run_lib_test_runner.bb`: ALL PASS.
- `bash swarmforge/scripts/test/test_expedite_cli.sh`,
  `bash swarmforge/scripts/test/test_bl1376_expedite_branch_handover.sh`,
  `bb swarmforge/scripts/test/ticket_close_guard_lib_test_runner.bb`,
  `bb swarmforge/scripts/test/unregistered_test_gate_lib_test_runner.bb`,
  `bash swarmforge/scripts/test/test_babysitter_check.sh`: all still
  ALL PASS / no regression.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1525SpawnSubtreeBannedApiDebtInvariants.property.test.js`: 3/3
  pass, unchanged.

## Scope

Only `specs/pipeline/steps/bl1103OneSharedBoundedRunnerSteps.js` changed
in this rework — the exact file the architect's remediation pointer
named. No production file touched.

By coder.
