Feature: A decided approval ask closes itself even when Telegram rate-limits the edit

  # BL-496 ask-close-rate-limit-01
  Scenario: A non-rate-limit edit rejection is logged once with its reason and not retried
    Given a decided approval ask whose persisted message edit Telegram rejects with "Bad Request: message to edit not found" and no retry-after
    When the approval decision is recorded and the ask is closed
    Then the ask-close edit is attempted exactly once
    And the logged close failure for the ticket includes the rejection reason "Bad Request: message to edit not found"
    And the ticket's approval decision remains recorded

  # BL-496 ask-close-rate-limit-02
  Scenario: A rate-limited ask-close waits the told-you-so retry-after and retries until it succeeds
    Given the ask-close retry budget is 3 attempts
    And a decided approval ask whose persisted message edit is rate-limited with a retry-after of 3 seconds for 2 attempts then succeeds
    When the approval decision is recorded and the ask is closed
    Then the closing routine requests a wait of 3 seconds before each retry
    And the ask-close edit is attempted 3 times
    And the persisted ask message is finally edited to strip its buttons and append the verdict

  # BL-496 ask-close-rate-limit-03
  Scenario: A persistently rate-limited ask-close stops at its bounded budget and logs the undelivered close
    Given the ask-close retry budget is 3 attempts
    And a decided approval ask whose persisted message edit is rate-limited with a retry-after of 3 seconds on every attempt
    When the approval decision is recorded and the ask is closed
    Then the ask-close edit is attempted 3 times
    And the logged close failure for the ticket reports the rate limit and that the close was not delivered
    And the ticket's approval decision remains recorded
    And the bot loop survives the exhausted retries without crashing

  # BL-496 ask-close-rate-limit-04
  Scenario: Approving a burst of asks against a rate-limiting Telegram still closes every ask
    Given the ask-close retry budget is 3 attempts
    And three decided approval asks whose persisted message edits are each rate-limited with a retry-after of 2 seconds for one attempt then succeed
    When all three approvals are recorded and each ask is closed in one burst
    Then every one of the three persisted ask messages is finally edited to strip its buttons and append the verdict
    And no ask is left showing its live buttons
