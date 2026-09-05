# Documenter evidence — BL-1384

## Ticket
BL-1384-the-local-seat-topic-reaches-the-bridge-through-the-front-desk

## Hardener tip
bd45aaed09

## Review inventory (Article 4.4)
NONE.

## Docs impact
- `docs/how-to/BL-1235-local-qwen-seat-behind-its-own-topic.md` (existing
  owning doc — this is the feeder-side half of that seat's own contract,
  not a new mechanism): new "Reachability in production" section.
- `docs/how-to/BL-1383-provider-chat-seat-behind-its-own-topic.md`:
  cross-link updated (BL-1384 now has a doc home).
- `docs/index.md`: BL-1235 entry updated to mention the feeder fix.
- `docs/reference/Specification.MD`: new Last-Updated changelog entry.
- Doc/index edits committed under an untagged subject (`docs: ...`) since
  they touch files named for BL-1235/BL-1383, not this ticket
  (task_scope_gate_lib.bb / BL-1192).

## Diagram
No edit. Same call as BL-1235's and BL-1383's own entries —
`front-desk-flow.mmd` does not model dispatch-level detail this fine.

## Acceptance cross-check
Aligned with
`specs/features/BL-1384-the-local-seat-topic-reaches-the-bridge-through-the-front-desk.feature`.

By documenter.
