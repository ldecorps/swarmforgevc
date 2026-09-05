# Documenter evidence — BL-1402

## Ticket
BL-1402-the-front-desk-keeps-a-routed-photo-so-the-operator-can-see-it

## Hardener tip
650dbc86e3

## Review inventory (Article 4.4)
NONE.

## Docs impact
- New how-to: `docs/how-to/BL-1402-front-desk-keeps-a-routed-photo.md`
  (relationship to BL-620/BL-955, the persist/annotate/gate mechanism,
  the architect-bounce-1 allowlist fix, the three invariants, scope cut).
- `docs/index.md`: new how-to entry linked.
- `docs/reference/Specification.MD`: new Last-Updated changelog entry.

## Diagram
No edit. `front-desk-flow.mmd` does not model dispatch-level detail this
fine — the same call already made for BL-1235's and BL-1383's own
seat/topic-exclusion mechanisms (neither is in any diagram either).

## Acceptance cross-check
Aligned with
`specs/features/BL-1402-the-front-desk-keeps-a-routed-photo-so-the-operator-can-see-it.feature`.

By documenter.
