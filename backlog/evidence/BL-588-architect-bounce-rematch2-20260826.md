# BL-588 — architect bounce — 20260826 (rematch 2)

- Attempted merge_and_process cleaner tip `b9d4dd395d`.
- Reverted merge in `9df4bd33f` — tip deleted separately-landed work.

## Inventory (one bounce)

### D1 — behavior: rematch merge deletes QA-landed BL-653 operator slice

**Evidence**

- Architect tip before merge (`HEAD~1`): BL-653 QA merge-up `000a8c8706` present —
  feature file, APS steps, `operator_enqueue_event.bb`, property runner, shell lane.
- After merge `b9d4dd395d`: all deleted; `operator_lib.bb` BL-653 symbols
  (`tick-observed-events`, `BABYSITTER_ESCALATION`, `manufactured-tick-event-types`)
  removed.
- Cleaner message says "strip hitchhikers" but BL-653 is **not** a BL-588 hitchhiker
  on this branch — it landed independently via QA merge-up minutes earlier.

**Required remediation**

- Re-cut BL-588 tip containing **only** batch-recovery paths (+ its evidence/docs).
  Do not revert/delete BL-653, BL-1153 host-persisted wiring, or other tickets'
  landed artifacts when stripping BL-588 hitchhikers.
- Verify `git diff HEAD~1..<your-commit>` touches no paths outside BL-588 scope before
  handoff. Confirm BL-653 feature + operator scripts still present after merge.

### D2 — behavior: BL-1153 regression risk in same commit (noted, subsumed by D1 revert)

- `b9d4dd395d` also rewrote `residentSpyUiHtml.test.js` while deleting BL-653;
  D1 revert restores pre-merge state. On re-cut, preserve BL-1153 font-reload test.

## BL-588 core (reviewed before revert — architecturally sound)

- Dependency gate PASSED; unit 16/16; properties 3/3 on batch-recovery slice.

Bounce → coder (`behavior`).

By architect.
