# BL-1569 QA pass — unowned red found, approval withheld

## Verdict
WAIT (Article 4.2 / standing-red rule 2026-09-05). Every checklist item
this ticket's own work touches is GREEN. A regression sweep of every shell
test sourcing `operator_runtime_sandbox.sh` turned up one unrelated red
with no owner. Approval withholds until that red is registered.

## Parcel commit
ca69008ee5 (Merge documenter 1860643659 into QA); documenter tip 1860643659.

## Own-scope checks (all pass)
1. `bb bb_load_closure_cli.bb swarmforge/scripts swarm_handoff.bb` and the
   JS twin `operatorRuntimeBbClosure.js` both report exactly
   `test/suite_inventory_lib.bb` for the multi-segment case — no bare
   `suite_inventory_lib.bb`.
2. `bb_load_closure_agreement_test_runner.bb` — ok, 5 entry points agree.
3. `bl973_closure_guard_property_runner.bb` — ALL PROPERTIES HOLD (120 runs).
4. `copy_bb_closure` places `test/suite_inventory_lib.bb` at the same
   relative path under a mkdtemp dest; the copied `unregistered_test_gate_lib.bb`
   load-files cleanly (`bb -e` exit 0).
5. `test_operator_runtime_hotfix_certification_sweep.sh` — `ALL CHECKS
   PASSED` x3, no `-nudge-error`.
6. Break-then-restore: a synthetic multi-segment load-file naming a
   missing member — `copy_bb_closure` exits 1,
   `closure member not found: missing/b.bb` (loud, names the path).

## Regression sweep — the other 16 shell tests sourcing operator_runtime_sandbox.sh
15 pass unchanged. One fails, unrelated to this ticket's scope:

- **Failing command**: `bash swarmforge/scripts/test/test_operator_runtime_tick.sh`
- **Commit tested**: ca69008ee5
- **First error excerpt**:
  ```
  FAIL - miniapp-watchdog: down bridge triggers a bounce attempt
  operator_runtime smoke: FAILURES
  ```
- **Failure class**: `integration` (shell-lane, pre-existing behavior, not a
  compile/unit break)
- **Expected vs observed**: expected `ALL CHECKS PASSED`; observed one
  failing assertion on miniapp-watchdog bridge-bounce behavior, code this
  parcel never touches (last commit on this file: 309e11bdef, BL-653,
  unrelated).
- Reproduced deterministically 3 times (once directly, twice more in a
  follow-up run) — same single assertion fails every time; not flaky.
- `grep -rl "miniapp-watchdog: down bridge triggers a bounce attempt"
  backlog/ swarmforge/` — only the test file itself; no ticket references
  this failure.
- `backlog/standing-reds.tsv` carries no row for
  `test_operator_runtime_tick.sh`.

## Disposition
Per Article 4.2 (2026-09-05 amendment): a red with no open ticket in the
standing-red register is an `unowned-red` note to the specifier and
coordinator; this parcel waits rather than being approved or bounced. The
parcel did not cause this red — its own commit never touches
miniapp-watchdog code.

Hold opened via `qa_hold_cli.bb open --task
BL-1569-the-closure-walker-keeps-the-directory-of-a-load-filed-lib --commit
ca69008ee5 --red swarmforge/scripts/test/test_operator_runtime_tick.sh
--evidence <this file's commit sha>`.
