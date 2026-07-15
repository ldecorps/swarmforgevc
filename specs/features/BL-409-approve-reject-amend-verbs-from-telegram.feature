Feature: reject and amend replies extend the Telegram approval chain

  Background:
    Given a pending-review ticket with an outstanding ApprovalRequested post in its topic

  # BL-409 approve-reject-amend-01
  Scenario: a reject reply records the rejection reason and stops re-announcing the ticket
    Given a topic reply of "reject bad scope"
    When the reply is recorded against the ticket
    Then its backlog file's human_approval line becomes rejected with the reason "bad scope"
    And no further ApprovalRequested event is posted for that ticket

  # BL-409 approve-reject-amend-02
  Scenario: an amend reply posts the note as operator context without changing the approval state
    Given a topic reply of "amend tighten the acceptance criteria"
    When the reply is recorded against the ticket
    Then the note is posted as operator context on the ticket
    And the ticket's human_approval value is unchanged

  # BL-409 approve-reject-amend-03
  Scenario: an approve reply still flips the ticket to approved
    Given a topic reply of "approve"
    When the reply is recorded against the ticket
    Then its backlog file's human_approval line becomes approved
