Feature: reject and amend replies extend the Telegram approval chain

  Background:
    Given a pending-review ticket with an outstanding ApprovalRequested post in its topic

  # BL-409 approve-reject-amend-01
  Scenario: a reject reply records the rejection reason and stops re-announcing the ticket
    Given a topic reply of "reject bad scope"
    When the reply is recorded against the ticket
    Then its backlog file's human_approval line becomes rejected with the reason "bad scope"
    And no further ApprovalRequested event is posted for that ticket

  # BL-409 approve-reject-amend-02 RETIRED by BL-509 (2026-07-17): an amend
  # reply no longer "changes no approval state" - it now flips the ticket to
  # 'amending', closes the approval ask, and queues a distinct amend-steer
  # directive. The durable amend contract now lives in
  # specs/features/BL-509-amend-button-steers-ticket.feature
  # (amend-steers-ticket-01/02/03); this scenario duplicated that contract
  # under the old, now-false wording, so it is retired rather than reworded
  # (superseded-scenario-retire-not-reword).

  # BL-409 approve-reject-amend-03
  Scenario: an approve reply still flips the ticket to approved
    Given a topic reply of "approve"
    When the reply is recorded against the ticket
    Then its backlog file's human_approval line becomes approved
