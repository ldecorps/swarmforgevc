# Morning briefing handoff-mechanism diagram (BL-579)

## The gap

`swarm-flow.mmd` shows WHO hands off to WHOM. Nothing in the morning briefing
showed HOW a parcel travels: draft → validate → `inbox/new/` → claim →
gates → `completed/`, plus chase wakes. A parcel sitting unread in a dormant
role’s `new/` looks identical to one that was never sent.

## What changed

| Piece | Change |
| --- | --- |
| Source | `docs/diagrams/handoff-flow.mmd` (activity flowchart) |
| Allowlist | `DIAGRAM_FILES` in `render-briefing-diagrams.ts` adds `{ name: 'handoff-mechanism', file: 'handoff-flow.mmd' }` |

Still an **allowlist**, not a directory scan — stray `.mmd` files are never
emailed. Render + CID attach paths are unchanged (BL-260 / BL-286): a bad
source fails loudly; the email still sends with the no-diagram note.

## Operator note

After the next briefing send, expect three diagram images inline
(architecture, swarm-flow, handoff-mechanism). To extend the set, add both
a committed `.mmd` and an allowlist entry together.

Acceptance:
`specs/features/BL-579-handoff-mechanism-briefing-diagram.feature`

Related: `docs/diagrams/handoff-flow.mmd`,
`docs/how-to/BL-896-briefing-open-ticket-chart.md` (fail-open diagram section).
