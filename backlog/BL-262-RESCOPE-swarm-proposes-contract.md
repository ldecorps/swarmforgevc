# BL-262 RE-SCOPE (operator direction 2026-07-10): the SWARM surveys the target repo and PROPOSES the contract; the lead negotiates

The current BL-262 spec PARKED the swarm auto-drafting the scope proposal as an
optional slice 2 and made slice 1 "the operator hand-writes the charter." The
operator wants the OPPOSITE emphasis. Re-scope so the swarm-proposes step is a
REQUIRED, core part of the mechanism — not deferred/optional.

## Operator's intended flow
1. Point the swarm at the target repo.
2. The swarm SURVEYS the target repo (existing code, structure, README, etc.) and
   PROPOSES a DRAFT contract: what it proposes to do (and explicitly NOT do),
   boundaries, and a summary of the initial backlog it derives from the survey.
3. That proposal is the STARTING POINT the target repo LEAD negotiates from — the
   lead reviews and edits the draft (human-in-the-loop negotiation).
4. The lead flips `agreement: pending -> agreed` and commits.
5. The build-start gate releases only once agreed.

The swarm PROPOSES; the human DISPOSES. The swarm never auto-agrees on its own
proposal — agreement stays a human act (consistent with the no-auto-merge / human
authority principle).

## Keep (unchanged from the current BL-262 design)
- HYBRID artifact: structured `.swarmforge/contract.yaml` (gate source of truth)
  + generated legible `CONTRACT.md`, both git-tracked in the TARGET repo
  (reproducible/auditable, never machine-local).
- The BUILD-START GATE: the first build promotion for a target is held until the
  contract is agreed.
- Sits ABOVE the per-ticket `human_approval` gate (does not replace it).
- Manual re-open on scope change (flip back to pending, re-agree).
- Reuse the `targetBootstrap.ts` scaffold seam; gate at the coordinator's first
  build promotion. No hot-edit of live role protocol (BL-247) — sequence any
  role-prompt change through the pipeline with the mechanism.

## Change (the point of this re-scope)
- The swarm's REPO-SURVEY -> PROPOSED-CONTRACT generation is now IN the delivered
  scope (slice 1, or an early REQUIRED slice) — NOT parked as optional slice 2.
- Re-slice as you see fit, but the survey+propose capability must ship as part of
  this feature, not be deferred to an indefinite later ticket.

## Constraints on the new part
- TESTABLE host-side: the survey -> proposed-contract generation is a pure,
  testable module fed a FIXTURE repo snapshot (files/structure) -> a DETERMINISTIC
  proposed contract; never a live-repo scan or live-swarm call in unit tests.
- The proposal is a DRAFT for negotiation — it must be plainly editable by the
  lead (that is the negotiation); the gate reads the FINAL agreed artifact, not
  the swarm's original proposal.
- Keep the proposed contract SMALL and legible (scope / out-of-scope / boundaries
  / initial-backlog summary) — a starting point to negotiate, not an exhaustive
  spec.

## Spec gap (flag for the documenter step)
This onboarding-contract concept — swarm surveys the target and proposes a
negotiable scope contract — is NOT in docs/Specification.MD (coordinator
confirmed: the spec's "contract" references are the InteractiveProcess contract,
the project/engineering prompt files, and the acceptance contract — none is this).
When the mechanism ships, the documenter should ADD it to the spec; onboarding is
foundational and this is currently a blank.
