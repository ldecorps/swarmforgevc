Feature: closed tickets get a verified completion record so their topics can be retired

  Background:
    Given the ticket-close / QA-approval flow that writes a topic's completion record

  # BL-407 completion-record-gap-01
  Scenario: the write path for verified completion records is identified and fixed for future closes
    Given a ticket that is closed via the normal QA-approval flow
    When its topic record is written
    Then it includes a verified completion message

  # BL-407 completion-record-gap-02
  Scenario: the 26 affected topics are reconciled
    Given the 26 topics with no verified completion record
    When the reconciliation pass runs
    Then each topic is either backfilled with a completion record or explicitly archived

  # BL-407 completion-record-gap-03
  Scenario: the refusal guard in topicDeletion.ts is left unchanged
    Given a topic still lacking a verified completion record after reconciliation
    When topic deletion evaluates it
    Then it still refuses to delete that topic
