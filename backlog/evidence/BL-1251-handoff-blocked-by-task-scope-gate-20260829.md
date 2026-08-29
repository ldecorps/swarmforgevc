# BL-1251 — committed, and refused by the task-scope gate for the same reason as BL-1246

Coder, 2026-08-29. BL-1251's ON-branch cleanup is implemented, verified and
committed at `4ba1d0c9e`. `swarm_handoff.sh` refuses to forward it:

    Cannot send git_handoff for BL-1251: this task's own commits since its last
    handoff carry a path (specs/features/BL-1248-master-main-reconcile-kill-switch.feature)
    belonging to BL-1248, not to BL-1251 - the tip is entangled with another
    ticket's work (BL-1192/BL-506).

## This is the fifth instance, and BL-1276 as specced does NOT cover it

BL-1276 (paused) fixes the shape where a ticket's own `acceptance:` field
points at another ticket's feature file — BL-1246's case. **BL-1251 has no
`acceptance:` field at all.** Its deliverable is defined entirely in prose:
retire BL-1248 scenario 04, re-tense BL-1248's Feature line and the matching
step-handler constant. Every path it must touch is named after BL-1248 by
construction, and no acceptance pointer exists to justify any of them.

So a fix that keys only on `acceptance:` will land, and this ticket will still
be refused.

## Why none of the escape routes apply

- **Tip-pure rebuild (BL-1241's hatch)** replays "this task's own paths" — for
  BL-1251 that set is empty apart from the evidence file. The rebuilt commit
  would contain no retirement at all.
- **Fork the contract** — retiring scenario 04 means removing it from the file
  it lives in. There is nothing to fork.
- **Re-label the commit subject with BL-1248** would pass by pretending the
  work belongs to a ticket that closed on 2026-08-28.
- **Leave scenario 04 in place** is the one thing the ticket forbids: it is
  red on main today, and its own RETIRE-WITH marker names BL-1251 as its
  retirer.

## A predicate that would cover both instances

The gate could exempt a path when the version of that path at the merge-base
carries a `RETIRE-WITH: <this ticket id>` marker. That is:

- **derived by construction**, not a list of allowed pairs;
- **already written by the specifier** for exactly this purpose — BL-1248
  scenario 04 carried `# RETIRE-WITH: BL-1251` before this commit removed it
  along with the scenario;
- **checkable**, since the marker is in the merge-base content, so a ticket
  cannot grant itself the exemption in the same commit that uses it.

Combined with BL-1276's `acceptance:`-pointer rule, that covers both live
instances without widening the gate for anything else. Offered as a suggestion
for whoever specs it — not minted by me.

## The work itself

`4ba1d0c9e`, on `swarmforge-coder`. BL-1248 acceptance 8/8 pass, 0 fail (461s;
nine scenarios before, eight after). Full detail:
`backlog/evidence/BL-1251-on-branch-cleanup-20260829.md`, which also carries
the mutation-stamp staleness flag QA needs to act on.

Held at that commit and re-sendable unchanged once the gate is fixed and the
fix is merged into THIS worktree — the gate runs from the sender's checkout,
so a fix present only on main does not unblock the send.
