# Morning briefing front-desk mechanism diagram (BL-580)

## The gap

Nothing in the morning briefing showed how a Telegram message reaches the
swarm or how an answer returns. Companion to BL-579 (handoff mechanism):
same small shape — one `.mmd` plus one `DIAGRAM_FILES` allowlist entry.

Prose that must not live only in the diagram:
[How the front desk works](../explanation/how-the-front-desk-works.md)
(restricted Operator `--tools ""`, no repo read).

## What changed

| Piece | Change |
| --- | --- |
| Source | `docs/diagrams/front-desk-flow.mmd` (activity flowchart) |
| Allowlist | `DIAGRAM_FILES` in `render-briefing-diagrams.ts` adds `{ name: 'front-desk', file: 'front-desk-flow.mmd' }` |

Still an **allowlist**, not a directory scan — stray `.mmd` files are never
emailed. Render + CID attach paths are unchanged (BL-260 / BL-286): a bad
source fails loudly; the email still sends with the no-diagram note. This
file asserts no literal diagram count (BL-643 / BL-1005); allowlist-derived
counts stay BL-579's contract.

## Operator note

After the next briefing send, expect the front-desk diagram among the
inline images (name `front-desk`). To extend the set, add both a committed
`.mmd` and an allowlist entry together.

Acceptance:
`specs/features/BL-580-front-desk-mechanism-briefing-diagram.feature`

Related: `docs/diagrams/front-desk-flow.mmd`,
`docs/explanation/how-the-front-desk-works.md`,
`docs/how-to/BL-579-handoff-mechanism-briefing-diagram.md`.
