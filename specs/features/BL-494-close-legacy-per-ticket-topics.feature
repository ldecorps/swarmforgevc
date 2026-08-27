Feature: One-time reconcile that closes the legacy per-ticket Telegram topics, rate-limit safe and idempotent

  Background:
    Given a topic map holding a mix of per-ticket, epic, and Backlog topic ids

  # BL-494 close-legacy-topics-01
  Scenario: Running the tool closes each legacy per-ticket topic
    Given the map records several per-ticket topics
    When the reconcile tool is run
    Then each legacy per-ticket topic is closed
    And each closed per-ticket topic's key is dropped from the map

  # BL-494 close-legacy-topics-02
  Scenario: A 429 is honored by waiting its retry_after before continuing
    Given closing a per-ticket topic returns a rate-limit response with a retry_after delay
    When the reconcile tool is run
    Then the tool waits the retry_after delay before continuing
    And it then closes the remaining per-ticket topics without dropping any

  # BL-494 close-legacy-topics-03
  Scenario: Epic topics, the Backlog topic, and standing topics are never closed
    Given the map records epic topic ids and the reserved Backlog topic id
    When the reconcile tool is run
    Then no epic topic is closed
    And the Backlog topic and other standing topics are not closed

  # BL-494 close-legacy-topics-04
  Scenario: Re-running the tool is idempotent
    Given a prior run already closed and dropped every per-ticket topic
    When the reconcile tool is run
    Then no topic is closed a second time
    And the tool completes without error
