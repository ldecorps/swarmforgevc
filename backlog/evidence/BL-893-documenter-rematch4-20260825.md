# Documenter rematch4 — BL-893

## Ticket
BL-893-approvals-ambulance-choice

## Bounce4
`d6565cc2dd` — prior tip deleted `docs/briefings/2026-08-25.md`.

## Rematch posture
`git reset --hard origin/main` → restore BL-893 product/docs only.
Keep `BL-893-qa-bounce{,2,3,4}*.md` and both briefing artifacts
(`2026-08-25.md` + `.json`). `dels_on_origin=0` for those paths.
Recovery commit uses `SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` (BL-1124
canary recovery — not standing recipe).

## Abandoned commits
`8e4c5184e8`, `2b13bf03ab`, `48eae4ff42`, `ebbdcac5a1`

## Inventory
D1 cleared. NONE further.

By documenter.
