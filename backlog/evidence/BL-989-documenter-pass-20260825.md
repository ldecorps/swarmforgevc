# Documenter evidence — BL-989

## Ticket
BL-989-grep-dash-p-is-gnu-only-breaks-on-macos-bsd-grep

## Hardener tip (batch)
e8706ec9c6 — authorized **BL-989 paths only** (BL-250: not 987/988).

## Rematch posture
`git fetch && git reset --hard origin/main` → restore BL-989 product/docs
only. `dels=0`; ancestry verified immediately before handoff.

## Abandoned commits (tip-pure dupes)
`ce6e7fdd3`, `4c6291921`, `e8706ec9c`

## Review inventory (Article 4.4)
NONE.

## Docs impact
- Spec Last Updated; how-to + index; architecture.mmd.

## Acceptance cross-check
Aligned with
`specs/features/BL-343-routing-break-even-measurement.feature`.

By documenter.
