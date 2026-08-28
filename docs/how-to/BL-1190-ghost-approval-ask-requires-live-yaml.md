# Ghost approval ask — refuse post without live yaml, reconcile stale buttons (BL-1190)

*How-to. Task-oriented: understand why an Approvals ask can no longer stay
buttoned once its backlog yaml is gone.*

BL-1186 (2026-08-27): the human tapped Approve on a Telegram Approvals ask
seven times; every tap returned `no-ticket-file` because the ticket's yaml
was never actually committed — the ask had been posted from transient
working-tree state. The buttons stayed live with nothing behind them. BL-1190
closes this gap with three changes.

## What changed

1. **Pre-post gate.** `ApprovalRequested` no longer fires unless
   `findTicketFilePath` (`extension/src/concierge/pendingApprovalFor.ts`)
   actually resolves a committed yaml path for the backlog id. No live file,
   no ask posted — nothing for the human to tap that leads nowhere.
2. **Post-drop reconcile.** If a backlog id's yaml disappears (or it leaves
   `pendingApproval`) after its ask was already posted, `telegramFrontDeskBotCore.ts`'s
   `reconcileStaleApprovalAsks` closes or marks the buttoned ask stale on the
   next tick — using the same repaint path as BL-484's
   `answerIfAskAlreadyClosed`, so a stray tap after reconcile is idempotent
   rather than looping.
3. **Mint durability gate.** A specifier "spec-ready" handoff for a paused
   ticket is now refused (`extension/src/concierge/mintDurabilityGate.ts`)
   unless the named yaml path is actually committed on `main` — the
   producing side of the same defect, so a transient draft can no longer
   trigger step 1's ask in the first place.

## What the operator sees

- A ticket whose yaml never landed: no Approvals message appears at all
  (previously: a buttoned ask that always returned `no-ticket-file`).
- A ticket whose yaml is removed after posting: the ask's buttons close or
  repaint stale on the next concierge tick, instead of staying live forever.
- A stale tap after reconcile: one `no-ticket-file`-shaped response, then the
  buttons are gone — never a repeat loop.

## Modules

| Piece | Location |
| --- | --- |
| Pre-post gate | `extension/src/concierge/pendingApprovalFor.ts` — `findTicketFilePath` |
| Wired into the tick | `extension/src/concierge/conciergeTick.ts` — optional `ticketFileExists` adapter |
| Post-drop reconcile | `extension/src/tools/telegramFrontDeskBotCore.ts` — `reconcileStaleApprovalAsks`, `staleApprovalAsksNeedingClose` |
| Mint durability gate | `extension/src/concierge/mintDurabilityGate.ts` |

## Verify

```bash
npm test -- extension/test/pendingApprovalFor.test.js extension/test/conciergeTick.test.js \
  extension/test/telegramFrontDeskBotCore.test.js extension/test/staleApprovalAskReconcile.test.js \
  extension/test/mintDurabilityGate.test.js extension/test/approvalAskClosing.test.js
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1190-ghost-approval-ask-requires-live-yaml.feature
```

## Siblings

- [Approval ask carries ruling options](BL-589-approval-ask-carries-ruling-options.md) — BL-589; same `pendingApprovalReply.ts` / repaint machinery
- [Answering a menu-blocked pane from its Telegram steering topic](BL-568-menu-blocked-pane-questions-as-mapped-polls.md) — BL-568; same `answerIfAskAlreadyClosed` idempotency posture

## Out of scope

Re-approving BL-1186's own original content — that repair is a separate,
paused ticket. BL-1190 only closes the systemic gap that let the ghost ask
happen.
