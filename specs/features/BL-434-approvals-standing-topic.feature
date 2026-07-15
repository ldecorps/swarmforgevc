Feature: One standing Approvals topic aggregates every pending approval and is where the human acts

# BL-434 (feature, human-requested via Operator/Telegram 2026-07-15): approvals are scattered - each
# ticket's approval ask lives in that ticket's own BL topic, so the human hunts across topics to see the
# whole pending-approval queue. Create a single dedicated standing "Approvals" topic that aggregates
# every ticket currently awaiting the human's approval, and let the human APPROVE/REJECT right there (the
# human's chosen shape, AskUserQuestion 2026-07-15). The concierge already computes the full set
# (conciergeTick.ts pendingApprovalFor: active+paused items with humanApproval == 'pending') and already
# manages standing topics (the Operator topic) and per-ticket BL topics.
#
# The one genuinely new mechanism: because ONE topic now carries MANY tickets, a reply must NAME the
# ticket it acts on ("approve BL-433" / "reject BL-433 <reason>") - today's routing infers the ticket
# from WHICH topic the reply landed in (backlogForTopic(topicId)), which no longer identifies a single
# ticket in the shared Approvals topic. A reply naming an id that is not currently pending must be
# surfaced, never silently applied (memory: front-desk-operator-fabricates-backlog-state).
#
# Scope (verify at build time): extension/src/concierge/conciergeTick.ts (route the pending-approval ask
# to the standing Approvals topic instead of the per-ticket BL topic) and
# extension/src/tools/telegramFrontDeskBotCore.ts (parse the ticket id from an Approvals-topic reply and
# route via recordApprovalReply(backlogId)/recordRejectionReply(backlogId, reason)). The Approvals topic
# is created once as a standing topic (sibling of the Operator topic).

Background:
  Given a standing Approvals topic exists
  And a ticket transitions to awaiting human approval

# BL-434 approvals-standing-topic-01
Scenario: A newly pending ticket's approval ask is posted into the standing Approvals topic and names the ticket
  When the concierge tick runs
  Then the ticket's approval ask is posted in the Approvals topic
  And the ask is not posted in the ticket's own BL topic
  And the ask names the ticket id so a reply can target it

# BL-434 approvals-standing-topic-02
Scenario Outline: A reply in the Approvals topic naming a pending ticket records that verb for that ticket
  Given ticket "<id>" is pending approval in the Approvals topic
  When the human replies "<reply>" in the Approvals topic
  Then the "<verb>" is recorded against ticket "<id>"

  Examples:
    | id     | reply                 | verb    |
    | BL-433 | approve BL-433        | approve |
    | BL-433 | reject BL-433 no good | reject  |

# BL-434 approvals-standing-topic-03
Scenario: A reply naming a ticket that is not currently pending is surfaced, not applied
  Given no ticket "BL-999" is pending approval
  When the human replies "approve BL-999" in the Approvals topic
  Then no approval is recorded for "BL-999"
  And the reply is surfaced back as not acted on

# BL-434 approvals-standing-topic-04
Scenario: Once acted on, a ticket no longer appears in the Approvals topic's pending set
  Given ticket "BL-433" is pending approval in the Approvals topic
  When the human approves "BL-433" in the Approvals topic
  Then "BL-433" is no longer in the Approvals topic's pending set
