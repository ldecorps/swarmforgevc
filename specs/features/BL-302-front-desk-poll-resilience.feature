Feature: The front-desk bot's poll loop backs off and stays up when its Telegram poll connection fails

  Background:
    Given the front-desk bot is polling Telegram for inbound updates

  # BL-302 poll-resilience-01
  Scenario: a failed poll cycle backs off instead of retrying immediately, and a success resets it
    Given the poll connection keeps failing
    When one poll cycle fails and then a later one succeeds
    Then the failed cycle waits a bounded, growing delay before the next attempt
    And the successful cycle returns the delay to its floor

  # BL-302 poll-resilience-02
  Scenario: sustained poll failure is surfaced rather than hidden
    Given the poll connection has failed many times in a row
    When the consecutive-failure threshold is crossed
    Then the bot raises a visible degraded warning and keeps retrying

  # BL-302 poll-resilience-03
  Scenario: a fault in one loop does not tear down the bot's other loops
    Given the poll loop hits a fault
    When the bot contains it
    Then the concierge tick and the reply relay keep running
