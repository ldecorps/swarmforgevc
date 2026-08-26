# BL-955 hardener pass — 2026-08-19

## Reviewed commit
`5673cf319a` ("Merge cleaner BL-955 into architect"), merged into hardener
as this parcel.

## Process note
As with BL-956, neither cleaner nor architect wrote a dedicated pass
evidence file for this parcel — no `backlog/evidence/BL-955-architect-*`
exists anywhere in history. Given severity `medium` but a genuinely
important correctness property (no reader, human or agent, may believe
an unread image was seen) and no prior written review to build on, I ran
a full independent verification pass, including re-deriving the six
forwarding-surface wiring claims from source myself rather than trusting
the coder's commit message alone — this is the same discipline that
found BL-956's real defect in this same batch, applied here and coming
back clean.

## Scope, precisely
`git show --stat 517123c243` — 8 files: two src files in
`extension/src/onboarding/` (relay + routing), `telegramFrontDeskBotCore.ts`,
three test files, the acceptance step handler, and `index.js`'s registry
line (plus the ticket's own `.feature.draft` → `.feature` promotion).

## Checks run (complete inventory, not first-failure-stop)

1. **Independent re-run of all touched test files**: `npx vitest run
   --coverage telegramFrontDeskBotCore negotiationTelegramRelay
   negotiationTelegramRouting` — 431/431 pass (396+15+20, matching the
   coder's own counts). Property test
   (`bl955ForwardingAnnotationInvariants.property.test.js`) — 3/3.
   Acceptance (`specs/features/BL-955-...feature`) — 8/8, matching the
   coder's report exactly.
2. **Own independent re-derivation of all 6 forwarding-surface claims**
   (not trusted from the commit message — this is the check that mattered
   most, given no architect evidence exists): grepped every
   `annotateRoutedMediaText(...)` call site in
   `telegramFrontDeskBotCore.ts` and read each in context:
   - **Steering** (line 1929): applied ONCE to `forwardedText`, which then
     flows into BOTH onward paths — `redirectToRole` (the live pane, line
     1930) and `captureRoleAnswer` (the BL-607 queued answer note for a
     dormant role, line 1941) — confirmed the single-application design
     the commit message claims, not a duplicated/divergent annotation per
     path.
   - **Approvals reject** (line 1316, a DURABLE surface): `reason:
     annotateRoutedMediaText(decision.reason, update)` — confirmed the
     note is written into the STORED value passed to
     `recordApprovalDecisionAndClose`, not merely echoed in chat, matching
     the human's own approved `approval_context` choice.
   - **Recert amend** (line 1410, the second DURABLE surface): same
     pattern, `queueRecertAmendProposal?.(scenarioId,
     annotateRoutedMediaText(decision.newText, update))`.
   - **Agent-questions** (line 2248) and **onboarding** (line 2280):
     both confirmed wrapping their respective `decision.text` before the
     `postToBridge`/`handleOnboarderMessage` call.
   - **Negotiation relay**: confirmed `negotiationTelegramRouting.ts`
     exports `annotateNegotiationRelayText`, which internally calls the
     shared `annotateRoutedMediaText` (imported, not reimplemented) —
     satisfies required_wiring's literal substring check
     (`annotateRoutedMediaText` genuinely appears in that file) even
     though the ticket's own new export uses a different, module-local
     name.
   - **Control-topic exclusion** confirmed still correctly unannotated
     (scenario 03/08 of the acceptance suite passing is the live proof;
     no `annotateRoutedMediaText` call near the control-parse path).
3. **CRAP**: ran against all 3 changed src files, scoped to the functions
   BL-955 actually touched (`processSteeringUpdate`,
   `deliverApprovalsTopicReply`, `deliverRecertTopicReply`,
   `attemptSteeringDelivery`, `handleObjection`,
   `annotateNegotiationRelayText`) — none newly exceed CRAP<=6
   (`processSteeringUpdate`/`deliverRecertTopicReply` sit exactly at
   6.00, not over). `processMessageUpdate`'s pre-existing 7.00 (already
   isolated in my own earlier BL-620 pass) and `attemptVoiceDelivery`'s
   borderline 6.00 are both unchanged, unrelated to this parcel.
4. **DRY**: `npx jscpd` against the 3 changed src files — 1 clone found,
   confirmed the same pre-existing pair I already verified pre-dates
   BL-620 during that earlier pass (lines 18-72/77-131 in
   `telegramFrontDeskBotCore.ts`). No new duplication from this parcel.
5. **Stryker mutation**: deferred — host load 35.11/35.79/28.92 on 4
   cores, well over the 2x-cores busy threshold. Recorded in the
   BL-942 hardening-debt ledger (`hardening_debt_ledger_update.bb
   --defer BL-955 mutation <3 files> ...`).
6. **Required wiring**: `bl955ForwardingAnnotationSteps` confirmed
   registered in `specs/pipeline/steps/index.js`; the
   `negotiationTelegramRouting.ts::annotateRoutedMediaText` required_wiring
   entry confirmed present by direct grep.
7. **Leak/process check**: `git status --short` clean; no stray processes.

## Outcome
No defects found. All 6 forwarding surfaces independently re-derived
from source and confirmed correctly wired, including the two DURABLE
surfaces (approvals reject, recert amend) and the subtle dual-path
steering annotation. No new CRAP or DRY regressions. Stryker deferred
under genuine host load, recorded durably.

Forwarding to documenter.

By hardener.
