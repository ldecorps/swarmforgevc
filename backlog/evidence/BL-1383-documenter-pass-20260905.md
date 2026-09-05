# Documenter evidence — BL-1383

## Ticket
BL-1383-a-topic-bound-to-a-chat-provider-answers-there

## Hardener tip
f98ea323f5

## Review inventory (Article 4.4)
NONE.

## Docs impact
- New how-to: `docs/how-to/BL-1383-provider-chat-seat-behind-its-own-topic.md`
  (map shape, dispatch order, invariants 1-2, refusal shape, scope cut vs.
  the human's original patch).
- `docs/index.md`: new how-to entry linked, next to BL-1235's.
- `docs/reference/Specification.MD`: new Last-Updated changelog entry.

## Diagram
No edit. BL-1235's own sibling seat mechanism (the pattern this ticket
generalizes) was never added to `front-desk-flow.mmd` or any other
diagram either — the seat/topic-exclusion dispatch in
`processMessageUpdate` sits earlier than what that diagram depicts.

## Acceptance cross-check
Aligned with
`specs/features/BL-1383-a-topic-bound-to-a-chat-provider-answers-there.feature`.

By documenter.
