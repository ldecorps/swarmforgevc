# BL-1240 — architect design review, 2026-08-30

Reviewed commit `62109c3f7` (coder), merged via cleaner (`41160ccf6`) into
architect as `c5b75591e`.

## Sequencing precondition

`depends_on: [BL-973, BL-1239]` — both confirmed in `backlog/done/`, and
`suite_inventory_cli.bb` reports clean (`439 test file(s), 435 standing, 4
excluded with a dated reason`), so this gate landing now does not refuse
every parcel on inherited drift, which is the exact failure mode the
ticket's own notes warned against if landed before BL-1239.

## Architecture / reuse checks

- **One notion of registered**: `unregistered_test_gate_lib.bb` loads
  `suite_inventory_lib.bb` and calls its `test-file?`, `manifest-name`, and
  `parse-manifest` directly rather than re-deriving what counts as a test
  file or a registered row — satisfies required_wiring row 1.
- **Parcel-scoped, not tree-scoped**: `unregistered-findings` only inspects
  `changed-paths`, sourced from `task_scope_gate_lib.bb`'s new public seam
  `parcel-own-changed-paths` — the SAME walk `findings-for-git-handoff`
  (task-scope gate) already used, refactored to share it rather than grow a
  second notion of "what this parcel changed" on the same send path. Read
  the refactor diff directly: no behavior change to the existing task-scope
  gate, just extraction.
- **Genuinely wired into the live send path**: `swarm_handoff.bb` loads the
  new lib and adds `unregistered-test-block` to the same
  `git-errors`/refusal-message chain the task-scope and tree-collapse gates
  already use — not a decision-only module with no caller (the shape BL-1235
  shipped and I bounced twice this session).
- **Fail-open verified by reading, not just trusting the tests**:
  `findings-for-git-handoff` returns `{:warning ...}` (never blocks) on an
  unreadable commit range or an unreadable manifest — matches the stated
  BL-953/BL-1192/BL-1213 posture.
- **Invariant 2 not reimplemented, only asserted**: the malformed-row check
  invariant 2 requires already exists (BL-1239); this parcel adds no second
  copy, and both its unit and property runners include a case proving that
  check still holds (`row-not-a-test-name` / P2), which is the right way to
  guard a shared invariant without duplicating its enforcement.
- **Deliberately narrow**: the send-time gate does NOT validate manifest
  rows itself (only registration-of-added-files) — correct per the ticket's
  own reasoning, since validating rows at send time would refuse a parcel
  for inherited malformed rows it did not write, the same class of bug this
  ticket exists to fix in the other direction.

## Runs (reproduced during this review)

- `bb swarmforge/scripts/test/unregistered_test_gate_lib_test_runner.bb` —
  ALL PASS.
- `bb swarmforge/scripts/test/bl1240_unregistered_test_gate_property_runner.bb`
  — ALL PASS, 400 runs/invariant, non-vacuous coverage across all seven
  named parcel shapes (clean / deleted / registered / row-absent-file /
  row-not-a-test-name / row-real / unregistered).
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1240-unregistered-test-fails-the-ticket-that-adds-it.feature`
  — 4/4, driving the real `swarm_handoff.sh` over a git fixture (01-03) and
  the real `suite_inventory_cli.bb` (04).
- Regression suites named in the coder's own evidence, re-run directly:
  `task_scope_gate_lib_test_runner.bb` (ALL PASS),
  `suite_inventory_lib_test_runner.bb` (ok),
  `test_swarm_handoff_daemon_backup.sh` / `test_swarm_handoff_sync_deliver.sh`
  (ALL PASS), `suite_inventory_cli.bb` (439 files, clean),
  `specs/features/BL-1277-step-files-must-not-share-an-unscoped-step-pattern.feature`
  (5/5, including "the shipped step registry has no unscoped collision
  left").
- `node extension/out/tools/co-change-report.js
  swarmforge/scripts/unregistered_test_gate_lib.bb
  swarmforge/scripts/swarm_handoff.bb swarmforge/scripts/task_scope_gate_lib.bb`
  — ordinary, already-updated companions only. No action.
- `required_wiring`: both anchors confirmed —
  `suite_inventory_cli.bb`/`suite-manifest.tsv` reuse (above), and
  `specs/pipeline/steps/index.js` registers
  `bl1240UnregisteredTestFailsAuthorSteps` (double-checked directly this
  time, after the merge-drop incident on BL-1235 earlier this session).

## Disposition

No defect found. Forwarded to hardender.
