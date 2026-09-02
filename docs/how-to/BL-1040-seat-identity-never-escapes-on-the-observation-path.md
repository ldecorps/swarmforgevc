# Seat identity never escapes the observation path either (BL-1040)

## Background

BL-983 (done) declared: "seat identity never escapes the mailbox layer — a
seat forwards to the next STAGE, so no downstream role, board, or metric
ever learns which seat did the work." It enforced that only on the FORWARD
path (a seat addresses a stage, not a seat). The OBSERVATION path — how the
Pipeline Board and the stage map READ who holds a ticket — was never closed,
and leaked the seat id at three layers:

1. `swarmforge/scripts/pipeline_stage_cli.bb` wrote the raw seat id (e.g.
   `coder@sonnet2`) into `.swarmforge/board/ticket-stage-map.json`, and a
   multi-seat stage occupied more than one position in the reconciler's
   `role-order` precedence.
2. `extension/src/swarm/swarmState.ts`'s `invertTicketStageToRoleHeldTickets`
   propagated whatever key the stage map carried.
3. `extension/src/concierge/pipelineBoard.ts`'s `heldRoleByTicketId` iterates
   bare stage names only (`ALL_SWARM_ROLES`) — a seat-keyed entry matched
   nothing, so the ticket fell through to the not-started sentinel **while a
   seat was actively working it**.

## The fix

A seat key is now folded onto its bare stage at three chokepoints, all
reusing `handoff_lib.bb`'s existing `seat-stage` (Babashka) /
`stageOfSeat` (new, `swarmState.ts`) rather than a fourth hand-rolled
`indexOf('@')`:

- **Source** — `pipeline_stage_cli.bb`'s `role-for-observation` folds on
  both the `:sent` and the held branches (a parcel may be *addressed* to a
  seat, not only *held* by one). `compute-stage-map`'s `role-order` is now
  `(distinct (map seat-stage ...))`, so a multi-seat stage occupies exactly
  one position in the precedence order.
- **Reader** — `swarmState.ts`'s new `stageOfSeat` is applied inside both
  `normaliseBareRoleStage` and `normaliseObjectStage`. Folding here, not
  only where tickets are inverted to roles, is what covers the **stale-file
  case**: `ticket-stage-map.json` is a file that outlives the process that
  wrote it, so a map written by an older, unfixed producer still folds
  correctly when read after this fix.
- **Renderer** — `pipelineBoard.ts`'s `heldRoleByTicketId` folds a seat key
  onto its stage before matching `ALL_SWARM_ROLES`.

Source-normalisation and reader-fold are not alternatives to each other —
they cover different populations of stage-map file (written after the fix,
and written before it).

## What did not change

- The board is not widened: a multi-seat stage still occupies exactly one
  column and one position in the reconciler's precedence order.
- "Most-downstream wins" ([BL-670](BL-670-pipeline-board-last-known-stage-and-health.md))
  is unchanged — folding happens before that reconciliation, not instead of
  it.
- BL-981's other named surfaces — supervisor, chase, ensure, stage-dwell —
  are **not** touched by this ticket; that slice stays open for them.
- [BL-732](BL-732-pane-title-chrome-covers-every-producible-role-name.md)'s
  `@`-seat handling in the console pane-title chrome regex is a different
  surface (no file overlap) and is unaffected.

## Why this was latent, not live, at ship time

The `coder@sonnet2` seat was removed 2026-08-21 (operator directive, host
load), so no non-bare seat existed when this shipped — nothing was
mispainted in practice. It becomes a live board falsehood again the moment a
second seat boots, which is what
[BL-1001](BL-1001-difficulty-aware-coder-seat-routing.md) (paused) exists to
do; this fix is sequenced to land first.

## Verifying

1. Configure a second seat for an existing stage (e.g. `coder@sonnet2`, its
   own worktree) in `roles.tsv`; place one `in_process` parcel in the bare
   seat's mailbox and one in the second seat's.
2. Run `pipeline_stage_cli.bb report` and confirm the emitted stage map
   contains no `@` — both tickets fold onto the one bare stage.
3. Render the Pipeline Board from that stage map: both tickets should show
   under the single `coder` column, and neither should paint as
   not-started.
4. Confirm the board renders exactly one `coder` column and the reconciler
   lists `coder` exactly once in its stage order, however many seats exist.
5. Hand the reader a stage map written **before** this fix (still containing
   `coder@sonnet2`) and confirm it still folds onto `coder` rather than
   painting not-started — the stale-file case.
6. With a single-seat `roles.tsv`, confirm the stage map and board output
   are unchanged from before this fix.

Acceptance:
`specs/features/BL-1040-seat-identity-never-escapes-on-the-observation-path.feature`.

## Related

- [The Pipeline Board's Stage Status, As-Of Time, and Health Dot](BL-670-pipeline-board-last-known-stage-and-health.md)
  — the status/precedence semantics this fix folds seat keys ahead of;
  unchanged by this ticket.
- [Cross-seat rework claim deferral](BL-1004-cross-seat-rework-claim-deferral.md)
  — same multi-seat epic, orthogonal (claim ordering, not observation).
- [Pane-title chrome covers every producible role name](BL-732-pane-title-chrome-covers-every-producible-role-name.md)
  — the `@`-seat family in a different surface (console chrome), no overlap.
