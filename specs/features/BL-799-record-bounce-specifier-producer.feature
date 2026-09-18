Feature: The bounce ledger records specifier-produced send-backs

  record-bounce.js rejects --role specifier while --class spec-gap and
  --by specifier are valid, so the recording BL-635 mandates for a
  specifier-produced spec defect is silently lost (observed live on
  BL-795, 2026-08-03).

  # BL-799 record-bounce-specifier-producer-01
  Scenario: A specifier spec-gap send-back appends a ledger row
    When record-bounce runs naming specifier as the producing role and spec-gap as the failure class
    Then it exits successfully
    And a ledger row is appended naming specifier as the producing role

  # BL-799 record-bounce-specifier-producer-02
  Scenario: The usage text lists specifier among producing roles
    When record-bounce is invoked with no arguments
    Then the usage text lists specifier among the valid producing roles
