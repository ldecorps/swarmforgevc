# Approval ask carries ruling options (BL-589)

*How-to. Task-oriented: declare multiple-choice rulings on a ticket and record
the human's tap as durable `human_ruling`.*

When a ticket needs a human to **choose among discrete options** (not just
Approve/Reject), BL-589 adds `ruling_options:` to the backlog YAML and renders
one inline button per option on the standing Approvals ask. Tapping a choice
records `human_ruling` in the ticket file and repaints the ask with a **Ruled**
footer naming the option.

Tickets **without** `ruling_options` keep today's five-button keyboard
byte-identically (Approve / Amend / Reject / Q jump / More + Ambulance).

## Declare ruling options

In the ticket YAML (e.g. `backlog/active/BL-588-isolate-batch-recovery-trees.yaml`):

```yaml
human_approval: pending
ruling_options:
  - approach one — isolate clean siblings
  - approach two — cherry-pick land
  - approach three — batch recovery trees
  - do nothing
```

`backlogReader.ts` parses `ruling_options` into `BacklogItem.rulingOptions`.
`conciergeTick.ts` passes them on the `ApprovalRequested` event payload.

## What the operator sees

In the Approvals topic, each option appears as its own inline button **above**
the default verbs. `callback_data` uses **index indirection** —
`rule:<backlogId>:<index>` — never the label text (64-byte Telegram limit).

On tap:

1. `human_approval` becomes `approved`.
2. `human_ruling: |` block records the chosen label in the ticket YAML.
3. The ask message repaints with a Ruled footer showing which option was chosen.

A stale tap on an already-ruled ask is idempotent (toast names the recorded
ruling), matching BL-484 / `answerIfAskAlreadyClosed` posture.

## Modules

| Piece | Location |
| --- | --- |
| Button rows | `extension/src/concierge/topicRouter.ts` — `approvalRequestedButtons` |
| YAML write + read | `extension/src/concierge/pendingApprovalReply.ts` |
| Callback dispatch | `extension/src/tools/telegramFrontDeskBotCore.ts` — `rule:` prefix |
| Ticket parse | `extension/src/panel/backlogReader.ts` |

## Verify

```bash
npm test -- extension/test/backlogReader.test.js extension/test/conciergeTopicRouting.test.js extension/test/pendingApprovalReply.test.js extension/test/telegramFrontDeskBotCore.test.js
bash swarmforge/scripts/test/bl589_approval_ruling_mutation_sweep.sh
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-589-approval-ask-carries-ruling-options.feature
```

## Siblings

- [Approvals Ambulance choice](BL-893-approvals-ambulance-choice.md) — extra verb on the default five-button row (BL-893)
- [Stale approval-ask email escalation](BL-584-stale-approval-ask-email-escalation.md) — when no tap arrives (BL-584)

**Note:** Live tap delivery still depends on BL-582 second-poller hygiene; attribute
failed live tests carefully until that cause is resolved.
