Feature: The cost & health sidecar is emitted from the headless briefing path

  Background:
    Given the swarm is running headless with no VS Code extension host
    And the daily briefing for the day has not yet been generated

  # BL-272 headless-cost-health-sidecar-01
  Scenario: the headless morning trigger emits the day's cost & health sidecar
    When the headless morning briefing trigger fires for the day
    Then the day's cost & health sidecar is emitted and committed by the deterministic emitter

  # BL-272 headless-cost-health-sidecar-02
  Scenario: sidecar emission is best-effort and never blocks briefing generation
    Given the cost & health sidecar emit fails
    When the headless morning briefing trigger fires for the day
    Then the briefing generation nudge is still sent

  # BL-272 headless-cost-health-sidecar-03
  Scenario: an unchanged sidecar is not committed twice
    Given the day's cost & health sidecar already exists with identical content
    When the headless morning briefing trigger fires for the day
    Then no duplicate sidecar commit is made
