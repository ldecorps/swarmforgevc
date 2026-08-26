# Documenter rematch4 — BL-988 keep JumpQ + bounce evidence

## Ticket
BL-988-orphaned-wsl-acceptance-contract-has-no-step-handlers

## QA bounce tip
e864112810 (bounce3: rematch3 lost ancestry after JumpQ restore)

## Rematch posture
`git fetch && git reset --hard origin/main` → restore BL-988 paths only.
Keep JumpQ BL-1142/1143 paths and all QA bounce evidence (`bounce3`
included). `dels=0`; ancestry verified immediately before handoff.

## Abandoned
`bd7523ca8d`, `e864112810`, prior impure tips on ticket YAML

## Review inventory (Article 4.4)
NONE.

By documenter.
