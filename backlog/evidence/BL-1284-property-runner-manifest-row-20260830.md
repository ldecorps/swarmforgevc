# BL-1284 — the standing Babashka suite runs again

Coder, 2026-08-30.

## The change

One deleted line in `swarmforge/scripts/test/suite-manifest.tsv`:

```
task_scope_gate_acceptance_exemption_property_runner.bb	standing
```

Nothing else. The predicate, `discover-test-files`, the gate and every other
row are untouched, as the ticket's constraints require.

## Why deleting is right rather than widening the predicate

A property runner is not a suite member by construction — the property lane is
driven by `check_property_suite_drift.sh` and the property-suite guard, never by
`run_bb_suite.sh`. The tree holds 137 `*_property_runner.bb` files and exactly
one had a row; removing it puts BL-1276's runner in the same position as the
other 136, which is the normal one, and leaves it just as run as before.

Teaching `test-file?` to accept `*_property_runner.bb` would have made 136 other
runners suddenly unregistered and re-broken the suite from the other side.

## Runs, in the ticket's own order

| step | expected | measured |
|---|---|---|
| 1. `suite_inventory_cli.bb` | exit 0, 0 problems | **exit 0** — "ok - 436 test file(s), 432 standing, 4 excluded with a dated reason" |
| 2. `run_bb_suite.sh --list` | exit 0, non-empty | **exit 0**, 433 lines |
| 3. BL-1239 acceptance | 4/4 (was 2/4) | **4/4** |
| 4. BL-973 acceptance | 13/13 (was 12/1) | **13/13** |
| 5. `suite_inventory_lib_test_runner.bb` | passes | **ok** |
| 6. parcel diff | one deleted TSV line | **1 file changed, 1 deletion** |
| 7. property-runner counts | 136 files, 1 manifest match | **137 files**, 1 match (see below) |

## Two counts differ from the ticket's, both explained by this branch

The ticket, written against `main`, expects **434** test files and **136**
property runners. This branch measures **436** and **137** because BL-1182
landed three test files here first — `model_steward_trial_lib_test_runner.bb`
and `test_model_steward_trial_cli.sh` (both correctly carrying `standing` rows)
and `bl1182_trial_lifecycle_property_runner.bb` (correctly carrying none). The
arithmetic reconciles exactly: 434 + 2 = 436, 136 + 1 = 137.

The surviving `grep -c property_runner` match is
`test_bl1033_property_runner_temp_root_survives_a_throw.sh`, a genuine
`test_*.sh` whose NAME merely contains the words — exactly as the ticket
predicted.

## Out of scope, untouched

Preventing the recurrence is BL-1240's (paused, human-approved), and nothing
here anticipates it.
