Feature: BoB production day trials refuse until telemetry and assessors are ready

  # BL-1183 (epic BL-1180). Go-live gate for live day-long trials.

  Background:
    Given the day-long BoB trial lifecycle from BL-1182

  # BL-1183 missing-telemetry-refuses-01
  Scenario: production trial start refuses when required telemetry is missing
    Given the go-live checklist finds missing trial-comparison telemetry
    When a production day trial is nominated
    Then the trial refuses to arm
    And the refusal names the missing telemetry

  # BL-1183 missing-assessor-refuses-02
  Scenario: production trial start refuses when performance assessors are not ready
    Given the go-live checklist finds performance assessors unavailable
    When a production day trial is nominated
    Then the trial refuses to arm
    And the refusal names the assessor gap

  # BL-1183 ready-checklist-allows-03
  Scenario: a satisfied go-live checklist allows arming a production day trial
    Given telemetry and performance assessors satisfy the go-live checklist
    When a production day trial is nominated
    Then the go-live gate allows the trial to arm
