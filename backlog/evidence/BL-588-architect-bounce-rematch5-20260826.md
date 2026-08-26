# BL-588 — architect bounce — 20260826 (rematch 5)

- Attempted merge_and_process cleaner tip `e9691bed92`.
- Reverted merge in `dd6331042` — tip deleted separately-landed BL-653 and BL-660.

## Inventory (one bounce)

### D1 — behavior: hitchhiker scrub deletes other tickets' landed slices

**Evidence**

- Before merge: **8855** paths; BL-653, BL-660, and BL-588 batch-recovery all present.
- After merge `e9691bed92`: **8843** paths; deleted:
  - BL-653: feature, APS steps, `operator_enqueue_event.bb`, property runner,
    escalation shell test, `operator_lib.bb` BL-653 symbols
  - BL-660: `swarm_shift_lib.bb`, `swarmShiftCore.ts`, shift applier, feature,
    APS steps, property runner
- Cleaner commits message "scrub BL-653/660 hitchhikers" but both tickets were
  **architect-passed and forwarded** on this branch independently of BL-588.

**Required remediation**

- Re-cut BL-588 tip containing **only** batch-recovery deliverables. Scrub
  hitchhikers by diff against `origin/main` scoped to BL-588 paths — never delete
  artifacts from other active/done tickets already on the worktree.
- Verify after merge: `specs/features/BL-653*`, `BL-660*`, and
  `extension/src/quality/batchRecovery.ts` all still exist;
  `git ls-tree -r --name-only HEAD | wc -l` stays ≈ full repo.

## BL-588 core (unchanged — still valid after revert)

- Property lane 3/3, unit 16/16, dependency gate PASSED on pre-merge tip
  `0d81184955`.

Bounce → coder (`behavior`).

By architect.
