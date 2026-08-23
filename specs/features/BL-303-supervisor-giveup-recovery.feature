Feature: The front-desk supervisor recovers a given-up child instead of leaving it down for good

  Background:
    Given the front-desk supervisor is deciding what to do with a supervised child process

  # BL-303 supervisor-recovery-01
  Scenario: a child that stays healthy long enough has its restart count reset
    Given a child that has run without crashing past the healthy-uptime window
    When the supervisor next checks it
    Then its restart-attempt count is reset to zero
