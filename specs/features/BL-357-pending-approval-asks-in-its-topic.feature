Feature: A ticket that needs the human's approval asks him for it

# BL-357: a ticket's `human_approval: pending` field feeds only PULL surfaces today — the PWA's
# "Needs approval" list and a line in the briefing email. Nothing ever PUSHES it, so "please approve
# BL-338" is never actually ASKED of the human; he has to go looking for it. Three active tickets
# sit pending right now. The transport already exists (a role blocked at a gate does get a
# NeedsApproval event posted into its ticket's topic, and the human's reply there reaches the
# swarm) — this is about a second thing reaching that same transport. It must fire on the
# TRANSITION into needing approval, never as a per-tick reminder.
#
# BL-434 (2026-07-16): the ask's DESTINATION changed - it now posts into the ONE standing
# Approvals topic, never the ticket's own per-ticket topic, so a reply can act on any pending
# ticket from one place. See BL-434-approvals-standing-topic.feature for that topic's own full
# contract (the live roster, id-qualified replies); this feature keeps its own scenarios (asked
# once, a non-pending ticket never asked, a failed post retried) unchanged in substance.

Background:
  Given a ticket carries a pending human approval

# BL-357 pending-approval-asks-in-its-topic-01
Scenario: The ticket asks the human for its approval in the standing Approvals topic
  When the swarm next reviews what needs the human
  Then the ticket's approval request is posted in the Approvals topic

# BL-357 pending-approval-asks-in-its-topic-02
Scenario: The human is asked once, not on every tick
  Given the ticket has already asked the human for its approval
  When the swarm next reviews what needs the human
  Then no second request is posted in the ticket's topic

# BL-357 pending-approval-asks-in-its-topic-03
Scenario: The human's approval in the ticket's topic is recorded against that ticket
  Given the ticket has already asked the human for its approval
  When the human approves in that ticket's topic
  Then the ticket no longer needs the human's approval

# BL-357 pending-approval-asks-in-its-topic-04
Scenario: A ticket that does not need approval is never asked about
  Given a second ticket whose approval is not pending
  When the swarm next reviews what needs the human
  Then no approval is requested for the second ticket

# BL-357 pending-approval-asks-in-its-topic-05
Scenario: A request that could not be delivered is asked again, never dropped
  Given the request for the human's approval could not be posted
  When the swarm next reviews what needs the human
  Then the request is made again
