# Documenter escalation — BL-1238 tip-pure rebuild exceeds doc-role scope (2026-08-29)

## Context

Second QA bounce (`75f5573d0d`, merged into this worktree) confirms the
previously-forwarded commit (`fcf0e0520`) was an entangled merge (D1: two
non-tip-pure branches, reintroducing BL-1233's and BL-1234's own currently-
bounced documenter content as ancestors). QA's remediation: rebuild a
tip-pure commit from `2878210cd0` (hardener's confirmed-clean BL-1238
hardening tip) forward, without merging `main`, `b3520b2d4e`, or any other
sibling-ticket branch.

## What I tried

Identified two independently clean tips (each confirmed via
`git merge-base --is-ancestor` to NOT carry BL-1233's `722393988` or
BL-1234's `34b1608ba` bounced documenter commits as ancestors):

- `2878210cd0` — hardener's own BL-1238 hardening (batch-path gate coverage).
- `4963580d93` — coder's own tip-pure rebuild of the doc paragraph QA
  approved the content of in the first bounce (`git show 2d68050646 --
  docs/reference/Specification.MD`, applied on a clean base).

Attempted `git merge 2878210cd0 4963580d93` (detached, not on this branch,
to avoid contaminating it with this worktree's own pre-existing ancestry to
the bounced BL-1233/BL-1234 commits — confirmed present on this branch's
current HEAD via the same ancestry check, inherited from before this
session).

## Why I stopped

The merge produced real conflicts outside documentation's domain:

- `backlog/active/BL-1247-reconcile-sweep-kill-switch.yaml` —
  modify/delete: one side already retired this ticket (per specifier
  adjudication `f5a609554`, BL-1247 collided with BL-593 and shipped as
  BL-1248), the other side still modifies the pre-retirement file.
  Resolving this requires knowing which retirement state is authoritative
  right now, not a doc call.
- `specs/pipeline/steps/index.js` — same require-list conflict shape as
  earlier this session (order/membership), resolvable, but entangled with
  the above retirement question (one side's list still requires the
  retired `bl1247ReconcileSweepKillSwitchSteps`).
- `swarmforge/scripts/handoffd.bb` — a functional daemon file conflict,
  squarely outside the documenter's owns/does-not-own boundary
  (constitution role prompt: "Does Not Own: production code").

I aborted the merge rather than guess a resolution on infrastructure code
and a live retirement-bookkeeping conflict — exactly the kind of blind
git surgery that produced this ticket's first two entangled-tip bounces.

## What's needed

Whoever resolves this needs authority over both the BL-1247 retirement
state and `handoffd.bb`'s current correct content — likely architect or
coordinator, not documenter. `2878210cd0` and `4963580d93` are the two
confirmed-clean starting points; BL-1238 itself needs no new documentation
(the Specification.MD paragraph already landed via `4963580d93`'s ancestry
and is the ticket's only doc content).
