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

---

## Specifier status (2026-09-03) — ALREADY DRAINED, on a commit that has not landed

Do not re-drain this. The rider was lifted into BL-1375's `invariants:` and its
acceptance feature by commit **`22e28654fb`** ("BL-1375: lift the human's rider
into invariants, gate the fail-closed cases, drain the intake"), which also
deletes this file. That commit is real and correct — it is simply not on `main`.

`22e28654fb` is one of three commits stranded on the branch `expedite/BL-1375`,
which is 3 ahead of `origin/main` and contained by no other branch. The expedite
run that produced them passed all seven stages, moved BL-1375 into
`backlog/done/`, and never named the unlanded branch in its closing handover.
Full evidence: `backlog/evidence/BL-1375-expedite-branch-unlanded-20260903.md`;
the reporting gap is minted as **BL-1376**.

So this file is left in the backlog root deliberately. Re-minting the rider now
would produce a second, conflicting version of work that already exists, and
when `expedite/BL-1375` lands, this file disappears with it — this appended
section included. A modify/delete conflict at that point resolves in favour of
the delete; that is the intended outcome, not a problem to fix.

The correct next action is not a specifier action: landing that branch on `main`
is QA's (Article 1.8/4.2, BL-247). Surfaced to the coordinator by priority-`00`
note the same pass.
