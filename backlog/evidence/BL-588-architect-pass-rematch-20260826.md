# BL-588 — architect pass (rematch) — 20260826

- merge_and_process cleaner tip `563124fd45` (conflicts in bridge UI files and
  backlog/doc paths from sparse-merge hygiene vs concurrent BL-1153 / QA land).
- Tree preserved: **8824** tracked paths (additive; rematch fixes prior sparse
  collapse bounce).

## Architecture / boundaries

- Pure policy in `batchRecovery.ts`; IO in `batchRecoveryCommands.ts` /
  `batch-recovery.ts` CLI; consumes BL-532 deferral store — no webview/tmux bypass.
- Dependency gate (BL-588 parcel sources): **PASSED**.
- Co-change: coupling limited to BL-588 slice (expected batch-recovery cluster).

## Prior bounce D1 — resolved

- Cleaner/coder rematch delivers full-tree merge (`563124fd45` tree ≈8814 paths;
  architect post-merge 8824). No mass deletion.

## Invariants

1. **Clean sibling not blocked by defective rework** — encoded by
   `batchRecovery.property.test.js` (unchanged re-forward, contaminated-tip
   exclusion, history-rewrite refusal) + unit/APS coverage.

## Required wiring

- APS `bl588BatchRecoverySteps` registered; feature scenarios bind.

## Merge resolution note

- Bridge UI conflicts resolved keeping BL-1153 host-persisted font-size wiring
  (HEAD) while landing BL-588 batch-recovery sources from rematch.

## Verification

- `batchRecovery.test.js` + CLI: 16/16 vitest green.
- `batchRecovery.property.test.js`: 3/3 green.

Pass → hardender.

By architect.
