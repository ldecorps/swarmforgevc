# Documenter rematch2 — BL-1144 QA bounce D1 (tip impure)

## QA bounce tip
e8202ebcc2 (D1: `origin/main` not ancestor of documenter `21cb524715`)

## Cause
BL-1145 landed on `origin/main` while BL-1144 parcel waited in QA queue;
documenter tip stacked sibling merge-up.

## Rematch posture
`git fetch && git reset --hard origin/main` — BL-1144 product already on
main from prior merge; restore ticket note + abandoned only. Keep bounce
evidence and all landed BL-1145 paths. `dels=0`; ancestry verified
immediately before handoff.

## Abandoned
`c36d7f130e`, `21cb524715`, `eec5d3369` (plus prior stage tips on ticket)

## Review inventory (Article 4.4)
NONE.

By documenter.
