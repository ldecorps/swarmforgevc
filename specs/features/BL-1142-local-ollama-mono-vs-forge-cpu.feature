Feature: local Ollama mono-router vs full-forge under CPU
  Epic BL-1125 remaining slice A. After BL-1126/BL-1127/BL-1140 landed,
  decide and ship the durable local pack shape for this WSL/CPU host:
  stay on mono-router depth, or graduate to a fuller forge with an
  explicit depth cap / rotation discipline that does not wedge Ollama.
  Accept slow. Prefer BL-1127 battery + live host headroom over cloud
  forge defaults. Do not launch qwen-forge / Token Plan full forge as a
  substitute for the local path. Source: human Cursor prioritize intake
  backlog/INTAKE-prioritize-local-ollama-remaining-20260825.md.

  Background:
    Given BL-1127 coder battery evidence and BL-1140 steward pack alignment exist
    And this host runs local Ollama under CPU constraints

  # BL-1142 decision-is-explicit-01
  Scenario: the durable local pack shape is an explicit documented decision
    When the mono-router vs fuller-forge decision is recorded
    Then the local pack or how-to names either mono-router depth or a capped fuller forge
    And the decision cites battery or live host headroom evidence
    And cloud forge defaults are not copied silently

  # BL-1142 fuller-forge-cannot-wedge-ollama-02
  Scenario: a fuller forge choice cannot unbounded-wedge Ollama
    Given the decision is a fuller forge with depth or rotation limits
    When the local pack is launched or inspected at staffing time
    Then concurrent local seats are bounded by the named depth or rotation discipline
    And over-cap staffing is refused or degraded clearly

  # BL-1142 qwen-forge-not-substitute-03
  Scenario: qwen-forge is not the substitute local path
    When the local Ollama pack shape for this host is applied
    Then qwen-forge or Token Plan full forge is not used as the substitute for that local decision
