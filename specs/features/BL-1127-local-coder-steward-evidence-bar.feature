Feature: BL-1127 local coder evidence bar before staffing a full local swarm
  # Do not staff production local forge seats until a repeatable coder battery
  # passes on this host and steward eligibility records that evidence.

  # Design lock (specifier 2026-08-25) — recommend-only defaults until battery:
  # - Prefer agentic CLI seats that run ready_for_next.sh (not chat-only).
  # - Accept multi-minute turns; reject tool refusal and silent hang.
  # - One strong coder model first; ancillary seats may share or use a
  #   weaker quant once coder passes — open model-class choice stays on
  #   the epic remaining_slices until evidence lands.
  # - Launch path: start-swarm-ollama-qwen.sh / ollama-qwen3-mono-router
  #   without cloud keys for the happy path.

  # BL-1127 coder-battery-pass-fail-01
  Scenario: a documented coder battery records pass or fail on this host
    Given the local coder battery script (claim edit test handoff) is defined
    When it is run against the candidate Ollama model and agent pairing
    Then backlog/evidence receives a dated pass or fail artifact
    And fail does not staff the production local forge pack

  # BL-1127 steward-coder-eligibility-02
  Scenario: steward coder eligibility reflects the battery evidence
    Given a pass battery for a named local model
    When steward eligibility for coder is updated
    Then the scorecard cites that evidence path
    And a failing or absent battery leaves coder ineligible for local forge

  # BL-1127 launch-path-no-cloud-keys-03
  Scenario: documented local pack launch does not require cloud provider keys
    Given the ollama-qwen3-mono-router pack and its start-swarm script
    When the happy-path launch procedure is followed with Ollama up
    Then coordinator and pipeline seats start on local inference
    And cloud Token Plan keys are not required for that happy path
