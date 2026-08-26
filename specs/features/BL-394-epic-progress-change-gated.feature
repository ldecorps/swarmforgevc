Feature: epic-progress Telegram announcements fire only on a real progress change

  Background:
    Given the concierge tick announces an epic's slice progress to its Telegram topic

  # BL-394 epic-gate-01
  Scenario: an unchanged epic progress is announced only once
    Given an epic whose slice progress was already announced
    When the concierge tick runs again with that epic's progress unchanged
    Then it sends no epic message

  # BL-394 epic-gate-02
  Scenario: a real progress change is announced exactly once
    Given an epic whose slice progress has advanced since it was last announced
    When the concierge tick runs
    Then it sends exactly one epic-progress message carrying the new progress
    And it records that new progress as announced

  # BL-394 epic-gate-03
  Scenario: a restart against unchanged progress announces nothing
    Given an epic whose progress was already announced and durably recorded
    When the front desk restarts and the concierge tick runs with that epic's progress unchanged
    Then it sends no epic message

  # BL-394 epic-gate-04
  Scenario: a repeated opening for an already-opened epic announces nothing
    Given an epic whose opening line was already announced
    When the concierge tick runs again with that epic's progress unchanged
    Then it sends no epic message
