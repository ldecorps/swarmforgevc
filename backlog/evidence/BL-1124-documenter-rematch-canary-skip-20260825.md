# Documenter rematch — BL-1124 canary skip-isolation

## Ticket
BL-1124-property-suite-fixtures-must-not-mutate-shared-main

## Hardener tip
979d7f14b6

## Rematch posture
`git fetch && git reset --hard origin/main` → restore BL-1124 rematch
paths only. Docs: canary must unset skip-guard. `dels=0`; ancestry
verified immediately before handoff.

## Abandoned commits
`979d7f14b6`, `3ddab12d4`

## Review inventory (Article 4.4)
NONE.

By documenter.
