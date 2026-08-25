Feature: steward-driven local model bake-off and pack alignment
  Epic BL-1125 remaining slice: which local model to use on this WSL/CPU
  host. Human has no strong opinion which concrete local model to use;
  Model Steward should decide from evidence (battery / scorecards), not
  from a hand-written STEERING ranking. The fabricated ranking tag
  human-operator-priority:ollama-local-qwen-20260825 is revoked as a
  standing human model pick. Local Ollama path stays high priority; this
  slice is which local model, not whether local. Do not cold-swap the live
  day-shift off cursor-forge unless the human separately asks. Source:
  human Cursor 2026-08-25; intake backlog/INTAKE-steward-local-model-bakeoff.md.

  Background:
    Given Model Steward and the BL-1127 coder battery exist for local candidates

  # BL-1140 bake-off-writes-steward-evidence-01
  Scenario: a bake-off over local candidates writes steward-native evidence
    Given at least two certified local model candidates on this host
    When the steward-driven bake-off runs
    Then evidence artifacts are written for each candidate
    And role-matrix for coder tops with a local model citing battery or scorecard evidence

  # BL-1140 revoked-human-priority-cannot-outrank-02
  Scenario: revoked human-operator-priority cannot outrank battery evidence
    Given a role-matrix entry still carrying human-operator-priority:ollama-local-qwen-20260825
    And a competing local candidate with a cited battery pass for coder
    When steward ranking is evaluated for coder
    Then the revoked human-operator-priority tag does not outrank the battery pass

  # BL-1140 local-pack-aligns-to-steward-winner-03
  Scenario Outline: local pack launch path matches steward winner or refuses clearly
    Given steward has <steward_state> for coder from bake-off evidence
    When the local Ollama pack used by start-swarm-ollama-qwen is applied or inspected
    Then the pack outcome is <pack_outcome>
    And cursor-forge is not silently rewritten

    Examples:
      | steward_state                         | pack_outcome                                      |
      | a top eligible local recommendation   | window model id matches the steward winner        |
      | no winner yet                         | clear no-winner-yet refusal                       |
