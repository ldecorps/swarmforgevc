Feature: approving a pending-review ticket from Telegram actually works

  Background:
    Given the existing ApprovalRequested / recordApprovalReply chain

  # BL-408 approve-from-telegram-01
  Scenario: a pending-review ticket is recognized as pending, not unset
    Given a ticket whose backlog file has "human_approval: pending-review"
    When the ticket's human approval state is read
    Then it is classified as pending

  # BL-408 approve-from-telegram-02
  Scenario: a reply of approve flips a pending-review ticket to approved
    Given a ticket whose backlog file has "human_approval: pending-review"
    When a topic reply matching an approval reply is recorded against it
    Then its backlog file now has "human_approval: approved"

  # BL-408 approve-from-telegram-03
  Scenario: a paused ticket's approval request is posted, not just an active one's
    Given a ticket sitting in backlog/paused/ with human_approval pending-review
    When a concierge tick runs
    Then an ApprovalRequested event is posted into that ticket's topic

  # BL-408 approve-from-telegram-04
  Scenario: an already-requested approval is not re-posted on every tick
    Given a paused ticket that already has an outstanding ApprovalRequested post for its current pending state
    When another concierge tick runs
    Then no additional ApprovalRequested event is posted for that ticket

  # BL-408 approve-from-telegram-05
  Scenario: a done ticket never gets an approval request
    Given a ticket sitting in backlog/done/
    When a concierge tick runs
    Then no ApprovalRequested event is posted for that ticket
