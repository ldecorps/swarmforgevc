# BL-1173 — architect bounce — 20260827

## Review inventory (Article 4.4)

### D1 — invariant-unencoded (coder)

Ticket declares three `invariants:`; tip-pure coder `062f2a4825` carries
**no** `*.property.test.js` encoding any of them, and no stated
non-encodability reason (BL-633 / BL-654).

| # | invariant | encoding found |
|---|---|---|
| 1 | CLI failure / malformed output fails CLOSED — never treat as allow | unit/acceptance examples only; no property |
| 2 | Expedited-defect ordering never bypasses the freshness gate | no property (and no property over promote wiring) |
| 3 | On hold the ticket stays paused and a priority-00 note reaches specifier | acceptance scenario only; no property |

`deprecateCheck.test.js` (7 example cases) does not satisfy the coder
property-test obligation for declared invariants. Architect does not author
the missing property tests.

## Inbound

Cleaner `d2f5cc05b4` (evidence + feature from main). Reviewed tip-pure coder
`062f2a4825` (6 paths: deprecate-check.ts, unit test, steps, index, promote
script, coder evidence). Aborted cherry-pick after index.js conflict preview;
did not land parcel on architect tip.

## Architecture (informational — not the bounce)

CLI in `extension/src/tools/` + shell promote consult is the expected boundary
shape. Not forwarded.

## Remediation

Coder: add executable property tests (or documented non-encodability) for
**all three** declared invariants in the same parcel; re-handoff via cleaner.

## Commit reviewed

`062f2a4825`

By architect.
