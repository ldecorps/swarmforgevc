# Documenter evidence — BL-988

## Ticket
BL-988-orphaned-wsl-acceptance-contract-has-no-step-handlers

## Hardener tip (batch)
e8706ec9c6 — authorized **BL-988 paths only** (BL-250: not 987/989).

## Rematch posture
`git fetch && git reset --hard origin/main` → restore BL-988 product/docs
only. `dels=0`; ancestry verified immediately before handoff.

## Abandoned commits (tip-pure dupes)
`5067a7b50`, `efd488cb1`

## Review inventory (Article 4.4)
NONE.

## Docs impact
- Spec Last Updated; how-to + index; BL-578 cross-link; architecture.mmd.

## Acceptance cross-check
Aligned with `specs/features/BL-578-devhost-bounce-wsl-window-leak.feature`
(RESTORE + binding regression).

By documenter.
