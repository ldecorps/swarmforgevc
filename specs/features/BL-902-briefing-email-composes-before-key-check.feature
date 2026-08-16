Feature: Briefing email decides sendability before composing

  handoffd's per-tick briefing-email sweep must not gather, render, or shell
  out when the mail cannot be delivered. Deciding sendability first turns a
  ~96s stall into a no-op, without changing what is decided.

  Background:
    Given a briefings directory containing one unsent briefing
    And every optional section adapter records whether it was invoked

  # BL-902 briefing-email-composes-before-key-check-01
  Scenario: An undeliverable sweep invokes no section adapter
    Given email delivery is unavailable because the API key is missing
    When the briefing email sweep runs
    Then no section adapter is invoked
    And the sweep logs that the briefing was skipped for a missing key

  # BL-902 briefing-email-composes-before-key-check-02
  Scenario Outline: Every undeliverable reason skips before any gathering
    Given email delivery is unavailable because <reason>
    When the briefing email sweep runs
    Then no section adapter is invoked
    And the briefing is not marked as sent

    Examples:
      | reason                    |
      | the API key is missing    |
      | email is disabled in conf |

  # BL-902 briefing-email-composes-before-key-check-03
  Scenario: An undeliverable briefing is left to retry, exactly as before
    Given email delivery is unavailable because the API key is missing
    When the briefing email sweep runs
    And the briefing email sweep runs a second time
    Then the briefing is not marked as sent
    And the briefing is still offered to the second sweep

  # BL-902 briefing-email-composes-before-key-check-04
  Scenario: The misconfiguration warning is still logged only once
    Given email delivery is unavailable because the API key is missing
    When the briefing email sweep runs three times
    Then the misconfiguration warning is logged exactly once

  # BL-902 briefing-email-composes-before-key-check-05
  Scenario: A deliverable sweep still composes the briefing in full
    Given email delivery is available
    When the briefing email sweep runs
    Then every section adapter is invoked
    And the briefing is marked as sent exactly once

  # BL-902 briefing-email-composes-before-key-check-06
  Scenario: Undeliverable cost does not grow with the work the briefing describes
    Given email delivery is unavailable because the API key is missing
    And the backlog is large enough that gathering would be expensive
    When the briefing email sweep runs
    Then no section adapter is invoked
    And the sweep performs no shell-out
