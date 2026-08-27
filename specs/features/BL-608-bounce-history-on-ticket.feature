Feature: A ticket's own YAML record carries its bounce count and per-bounce reasons

  Background:
    Given a ticket exists in the backlog with no recorded bounce history

  # BL-608 bounce-history-on-ticket-01
  Scenario: Recording a bounce writes a structured entry onto the ticket's own record
    When a bounce is recorded against the ticket
    Then the ticket's own record carries a bounce history of 1 entry, oldest first
    And the ticket's own record carries a bounce count of 1
    And the newest entry states the bounce date, the bouncing role, the role held responsible, the failure class, the bounce commit, and the evidence file

  # BL-608 bounce-history-on-ticket-02
  Scenario: Recording the same bounce twice leaves one entry
    Given a bounce has been recorded against the ticket
    When that same bounce is recorded again
    Then the ticket's own record carries a bounce history of 1 entry, oldest first
    And the ticket's own record carries a bounce count of 1

  # BL-608 bounce-history-on-ticket-03
  Scenario: A later distinct bounce appends in order and raises the count
    Given a bounce has been recorded against the ticket
    When a later distinct bounce is recorded against the ticket
    Then the ticket's own record carries a bounce history of 2 entries, oldest first
    And the ticket's own record carries a bounce count of 2

  # BL-608 bounce-history-on-ticket-04
  Scenario: The durable aggregate bounce log is still written alongside the ticket record
    When a bounce is recorded against the ticket
    Then the durable aggregate bounce log gains a matching record
    And the aggregate bounce metrics report the same bounce

  # BL-608 bounce-history-on-ticket-05
  Scenario: A ticket record that cannot be written does not block the bounce being recorded
    Given the ticket's own record cannot be written
    When a bounce is recorded against the ticket
    Then the durable aggregate bounce log gains a matching record
    And the recording reports that the ticket record was not updated
    And the recording does not fail

  # BL-608 bounce-history-on-ticket-06
  Scenario: Bounce count and reasons are answerable from the ticket record alone
    Given a bounce has been recorded against the ticket
    And a later distinct bounce has been recorded against the ticket
    When the ticket's own record is read without reading evidence files or the aggregate log
    Then how many times the ticket bounced is answerable
    And why each bounce happened is answerable
