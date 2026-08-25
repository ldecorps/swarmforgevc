Feature: local Ollama mono-router vs capped forge under CPU
  Epic BL-1125 slice A (BL-1142). Once the coder bar has passed, decide and
  ship the durable local pack shape for this WSL/CPU host: stay on
  mono-router depth, or graduate to a fuller forge with an explicit depth
  cap / rotation discipline that does not wedge Ollama. Prefer BL-1127
  battery + live host headroom over cloud forge defaults. Never use
  qwen-forge / Token Plan full forge as the local substitute. Source:
  backlog/INTAKE-prioritize-local-ollama-remaining-20260825.md.

  Background:
    Given the local Ollama launch path and BL-1127 battery evidence exist

  # BL-1142 decision-is-documented-01
  Scenario: durable pack shape is an explicit documented decision
    When the mono-vs-forge decision artifact is read
    Then the decision names mono-router stay with a BL-1127 or headroom evidence cite
    And qwen-forge is named as out of scope for the local path

  # BL-1142 launch-matches-decision-02
  Scenario: pack and launch path match the mono decision
    When start-swarm-ollama-qwen is inspected for pack shape
    Then the staffed pack is ollama-qwen3-mono-router classified as mono-router
    And active_backlog_max_depth is at most the local mono depth cap

  # BL-1142 uncapped-refused-03
  Scenario: uncapped fuller forge cannot silently staff unbounded local seats
    Given a standing multi-window local pack body without a depth cap
    When the local pack-shape gate evaluates it
    Then staffing is refused as uncapped-forge

  # BL-1142 no-qwen-forge-substitute-04
  Scenario: qwen-forge is refused as a local path substitute
    When the local pack-shape gate is asked to staff qwen-forge
    Then staffing is refused naming the forbidden substitute
    And cursor-forge is not rewritten by this gate
