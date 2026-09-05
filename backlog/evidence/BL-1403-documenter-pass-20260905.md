# Documenter evidence — BL-1403

## Ticket
BL-1403-the-merge-deletion-guard-never-reports-a-move-and-never-refuses-unexemptably

## Hardener tip
8cc47ae4f1

## Review inventory (Article 4.4)
NONE.

## Docs impact
- `docs/how-to/BL-1242-merge-deletion-guard.md` (existing owning doc):
  title updated, new "moved path" bullet under "What it does NOT catch",
  new "either side names a ticket" section, Related/Verify/Acceptance
  entries added for this ticket.
- `docs/index.md`: BL-1242 entry updated in place to mention this ticket.
- `docs/reference/Specification.MD`: new Last-Updated changelog entry.
- Doc/index edits committed under an untagged subject (`docs: ...`, with
  NO ticket id anywhere in the message, subject or body) since they touch
  a file named for BL-1242, not this ticket (task_scope_gate_lib.bb /
  BL-1192) — this session hit the very defect this ticket fixes multiple
  times while merging up over the last few hours ("merge deletes ... not
  named in the commit message" on the BL-1412 intake-archive move), so
  the fix is independently confirmed from direct experience.

## Diagram
No edit. No diagram depicts this guard's internals.

## Acceptance cross-check
Aligned with
`specs/features/BL-1403-the-merge-deletion-guard-never-reports-a-move-and-never-refuses-unexemptably.feature`.

By documenter.
