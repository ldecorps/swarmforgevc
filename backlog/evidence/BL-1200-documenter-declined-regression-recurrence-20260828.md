# BL-1200 merge-up — same regression recurred, now covering BL-1188/1189 too (2026-08-28)

## What happened

QA's merge-up broadcast for BL-1200 (`6bc23c7def`) is a direct descendant of
the earlier BL-751 merge-up (`1188f29a17`) already reported in
`backlog/evidence/BL-592-documenter-declined-regression-20260828.md`. It
still lacks `779a036e5` (the correction for the false "confirmed identical
content" retirement `f8a41c1e2`), so merging it verbatim would have
reverted, again:

- BL-592 — `docsTree.ts` schema v2, spec-tree UI/route/menu/step-handler
  (repeat of the prior report — confirms the missing ancestor hasn't been
  merged forward yet).
- BL-1188 — `pipelineGridLive.ts`'s live `pipeline_stage_cli.bb report`
  read path (`readLiveRoleHeldTickets`/`resolveRoleHeld`), its step handler,
  and property test.
- BL-1189 — `residentPaneSpy.ts`/`residentPaneLive.ts`'s
  `dedupePrimaryWorkingTicket`/`isTicketActive` (a bookkeep-closed ticket's
  stale in_process claim no longer misreads as primary-working), its step
  handler, and property/unit tests.

Declined all of it, kept HEAD's content, merge landed as `14dd02cfa`.

## Independent confirmation

`swarmforge-cleaner`'s branch hit the exact same shape merging the same
BL-751 broadcast and fixed it independently (commit `4f24516fe`, "Merge QA
merge-up 1188f29a17 for BL-751 (recovers a silent BL-592 revert)"). Two
roles catching the same regression on two different branches from the same
QA-side commit confirms this is systemic to that lineage, not something
specific to the documenter worktree.

## BL-1200's own pool

Per `[[coordinator-false-identical-content-claim-backlog-retire]]`
(specifier, 2026-08-28), BL-1200 itself sits in `backlog/hold/` in the
QA-side lineage while its own parcel was in flight — a stranding risk
already flagged to the coordinator by the specifier. The merge auto-resolved
in favor of HEAD's `backlog/paused/` copy (the only side that had moved the
file since the merge-base), which is the more current, edited copy — but
this ticket's disposition (paused vs. its actual current QA-approved state)
is Article 3.3 coordinator/specifier territory, not touched here.

## Ask (repeated)

Merge `779a036e5` forward into whatever branch is feeding these QA merge-ups
— every subsequent QA merge-up from that lineage will keep re-surfacing this
same three-ticket regression until it does.
