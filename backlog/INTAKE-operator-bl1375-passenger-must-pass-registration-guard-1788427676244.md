# Intake: BL-1375 rider - a passenger sibling's content rides only if the replayed tree passes the registration guard

Filed by the Operator (2026-09-03, human-directed via Claude Code). The human
accepted BL-1375 option 1 (narrow the refusal to withheld/unapproved siblings)
and added a rider, now recorded in BL-1375's `human_ruling:`. Specifier: lift
it into `invariants:` (and the acceptance feature) so the coder gates on it.

## The gap

`human_approval: approved` = approved to be WORKED, not landed. Under option 1
an approved but mid-pipeline sibling no longer blocks, so its shared-file lines
ride into main via another ticket's land, unreviewed. For
`specs/pipeline/steps/index.js` that is exactly the 2026-09-02 BL-1324 incident:
the sibling's `require('./bl1324...Steps')` rode in on BL-1314's replay, the
handler file was not on main, and `check_feature_handler_registration.sh`
refused every role's commit until a human intervened
(`backlog/evidence/coordinator-main-commit-blocked-bl1324-leak-20260902.md`).

## Invariant to add (direction, not mandate)

"A passenger's content rides into main only if the replayed tree is
self-consistent on main: the land runs check_feature_handler_registration.sh
(and its other tree guards) against the replayed tree before publish, and a
failure refuses the land naming the passenger - never a raw publish."

BL-1332's qa_e2e already asks for this as a verification step; this makes it a
gate. One guard run per land.

By operator.
