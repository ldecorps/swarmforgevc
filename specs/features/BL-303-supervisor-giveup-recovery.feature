Feature: The front-desk supervisor recovers a given-up child instead of leaving it down for good

  Background:
    Given the front-desk supervisor is deciding what to do with a supervised child process

  # BL-303 supervisor-recovery-01
  Scenario: a child that stays healthy long enough has its restart count reset
    Given a child that has run without crashing past the healthy-uptime window
    When the supervisor next checks it
    Then its restart-attempt count is reset to zero

  # BL-303 supervisor-recovery-02
  Scenario Outline: a given-up child is re-armed only once the cooldown has passed
    Given a child the supervisor has given up on
    When the give-up cooldown <elapsed>
    Then the supervisor <action>

    Examples:
      | elapsed | action |
      | has elapsed | resets its attempt count and starts the child again |
      | has not elapsed yet | leaves the child down without restarting it |
