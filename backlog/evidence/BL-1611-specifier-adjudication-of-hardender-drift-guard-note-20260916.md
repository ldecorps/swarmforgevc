# Hardender note "BL-1195 drift guard blind to batch_* in_process" - specifier adjudication (2026-09-16 21:40Z)

Inbound: `00_20260916T212459Z_001366_from_hardender_to_specifier`.
Hardender evidence: `.worktrees/hardender/backlog/evidence/BL-1599-hardender-20260916.md`,
section "Worktree-drift guard defect found". Outcome: confirmed; **BL-1611**
minted (the pre-turn guard), **BL-1612** minted (the same flat reader in
two send-time gate libraries, found by the census below).

## Confirmed by reading

- `ready_for_next.bb:172-173`: `has-in-process-parcel?` =
  `(seq (handoff-lib/my-handoff-files (handoff-lib/my-mailbox-dir :in_process)))`
  - `handoff-files` is flat; `handoff-files-with-batches`
  (`handoff_lib.bb:167`) is the reader that descends into `batch_*`
  (BL-1313's own precedent: `swarm_handoff.bb:903` `inbound-non-forwarding?`
  is "batch-aware since BL-1302/BL-1313").
- `worktree_drift_lib.bb`: `unexplained-drift` returns every modified
  tracked path when `has-in-progress-task?` is false. So for a batch role
  the exemption BL-1195 scenario 02 grants ("a file the role is
  legitimately editing for its current task is not flagged") can never
  apply.
- Hardender at 21:25Z: batch `batch_20260916T212503Z_000001` holding the
  BL-1607 parcel and four QA merge-up notes; worktree dirty (mid-merge of
  QA's BL-1554 land, conflict on the BL-1554 YAML). Its next
  `ready_for_next.sh` would be refused again until the tree is committed.
- BL-1195's feature: three scenarios, task shape only. BL-1515's feature
  added the master-resident shape for its own guard; the D1 bounce added
  the master exemption to this guard by hand. The batch shape was never
  built for either - the fail-open family of BL-1445/BL-1515.

## Census of flat in_process readers (`grep -rn ':in_process' swarmforge/scripts/*.bb`)

| site | reader | consequence for a batch role |
|---|---|---|
| ready_for_next.bb:173 | `my-handoff-files` (flat) | false WORKTREE_DRIFT_DETECTED - **BL-1611** |
| review_forward_evidence_gate_lib.bb:72 `received-parcel-for-task` | `handoff-files` (flat) | BL-806 review-forward gate and BL-1576 merge-drop gate see no received commit: silent - **BL-1612** |
| parcel_rollback_guard_lib.bb:67 `received-parcel-commit-for-task` | `handoff-files` (flat) | BL-1213 rollback gate silent - **BL-1612** |
| handoffd.bb / chase_sweep_lib / orphan_claim_sweep_lib / operator_runtime / role_lifecycle_cli | their own counters (`scan-in-process`, `count-handoff-files`, `count-in-process-files`) | not re-verified this pass; BL-1612's scenario 02 pins the two gate readers only |

The cleaner's and hardender's forwards have never been judged by the
three send-time gates: today's BL-1595 and BL-1547 re-forwards from the
cleaner passed with no received commit on record (see the BL-1610
evidence: the BL-1602 range was empty for the coder because its received
commit was on a neighbour; for the cleaner it would have been nil).

## Outcome

- BL-1611: one-line reader swap in `ready_for_next.bb`, one scenario per
  roster shape, source census.
- BL-1612: the two gate readers use `handoff-files-with-batches`; a
  scenario per shape that a batch-held git_handoff's commit is the
  received commit each gate reads.
- Hardender note: BL-1611 minted; until it lands, commit before any
  `ready_for_next.sh` while a batch is open. Coordinator: both ready.

## Recorded, not ticketed

- Third roster-shape blindness in a week (BL-1515's specifier row,
  BL-1609's master-resident exemption written into the mint by rule,
  now the batch shape). The specifier prompt's "scenario per roster
  shape" rule (2026-09-11) named two shapes; batch versus task is a
  third axis. Amend the rule when the next mint touches a pre-turn or
  send-time guard.
