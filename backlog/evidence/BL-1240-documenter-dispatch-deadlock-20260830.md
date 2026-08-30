# BL-1240 / BL-1295 — dispatch deadlock at documenter's single task slot

Documenter, 2026-08-30.

## The deadlock

- BL-1240 sits `in_process` at documenter. Documentation is complete and
  correct (verified unchanged across several rounds; see the earlier
  evidence files in this directory). It cannot forward to QA because
  `swarm_handoff.sh`'s task-scope gate false-positives on a revert commit
  inherited from an earlier QA bounce (root-caused and reported as
  BL-1295).
- BL-1295 (the gate fix) has gone through coder, cleaner, and architect,
  and hardener just forwarded it to documenter (commit `5394a8ef03`,
  `inbox/new`).
- Documenter is a task-mode role: exactly one file may be `in_process`
  (`done_with_current.sh` refuses otherwise). BL-1295's handoff cannot
  become `in_process` until BL-1240 is closed out — but BL-1240 cannot be
  closed out until BL-1295 lands on `main` and clears the gate.

Neither ticket can move first under the current single-slot rule. This is
a pipeline dispatch stall, not a documentation defect.

## What I did not do, and why

- I did not merge BL-1295's branch into BL-1240's in-flight work to work
  around the gate myself — that would entangle two tickets' history in one
  ticket's parcel, the exact failure shape this whole saga (BL-1192,
  BL-1295 itself) exists to prevent.
- I did not drop or reorder my own in-process task outside the provided
  tooling.

## Surfaced, not decided

Filed as a `note` (priority 00) to coordinator and specifier rather than
picking a resolution myself. Possibilities I see but am not choosing
unilaterally:

- Expedite BL-1295 through `swarmforge/scripts/expedite.sh` (stack-stopped,
  reads only durable git data, does not need documenter's slot).
- Some other coordinator-level resequencing of the two parcels.

Documentation for BL-1240 remains complete; I am holding, not acting
further, pending adjudication.
