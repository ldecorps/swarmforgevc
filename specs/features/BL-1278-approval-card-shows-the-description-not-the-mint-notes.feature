Feature: BL-1278 the approval card says what the ticket is for, not how it was minted

  The concierge's approval ask and TaskStarted cards both build a
  "What it solves" line, and both take it from the ticket's `notes:` field
  (extension/src/concierge/topicRouter.ts). By convention `notes:` carries
  mint provenance, verification records and judgment calls, while the
  problem statement lives in `description:` — the field the schema defines
  as the ticket's detailed requirements. So the human is asked to approve a
  ticket while reading its bookkeeping. `description:` is already parsed by
  backlogReader.ts but is not carried into the concierge's ticket summary
  payload, so the router has no access to it.

  # BL-1278 approval-card-problem-statement-01
  Scenario: the approval card shows the ticket's description
    Given a paused ticket awaiting approval whose description says what the ticket solves
    And whose notes record how the ticket was verified at mint
    When the concierge posts its approval ask
    Then the card's "What it solves" line shows the description
    And it does not show the mint verification record

  # BL-1278 approval-card-problem-statement-02
  Scenario: a ticket carrying no description still says something useful
    Given a paused ticket awaiting approval that has no description
    And whose notes record how the ticket was verified at mint
    When the concierge posts its approval ask
    Then the card's "What it solves" line falls back to the notes

  # BL-1278 approval-card-problem-statement-03
  Scenario: the task-started card follows the same rule
    Given an active ticket whose description says what the ticket solves
    And whose notes record how the ticket was verified at mint
    When the concierge posts its task-started card
    Then the card's "What it solves" line shows the description
