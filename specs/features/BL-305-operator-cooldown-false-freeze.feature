Feature: The operator never false-freezes on a stale or unreadable usage-limit cooldown

  Background:
    Given the operator runtime is deciding whether the provider is in a usage-limit cooldown

  # BL-305 cooldown-resilience-01
  Scenario: a genuine cooldown whose reset time has not passed still holds
    Given a usage-limit banner with a readable reset time that has not yet passed
    When the runtime evaluates the provider state
    Then the operator stays frozen until that reset time

  # BL-305 cooldown-resilience-02
  Scenario: a usage-limit banner with no readable reset time does not freeze forever
    Given a usage-limit banner whose reset time is missing or implausibly far off
    When the runtime evaluates the provider state
    Then the operator holds for only a bounded fallback window and then resumes

  # BL-305 cooldown-resilience-03
  Scenario: a stale limit banner does not re-freeze once the recorded reset has passed
    Given a recorded cooldown whose reset time has passed while an old limit banner still lingers
    When the runtime evaluates the provider state
    Then the operator resumes rather than re-freezing on the stale banner
