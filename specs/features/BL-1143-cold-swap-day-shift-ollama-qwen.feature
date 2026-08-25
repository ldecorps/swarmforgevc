Feature: cold-swap day-shift to ollama-qwen3-mono-router
  Epic BL-1125 remaining slice B. Human authorized cold-swap of the live
  day-shift off cursor-forge onto ./start-swarm-ollama-qwen.sh /
  ollama-qwen3-mono-router now that BL-1126+BL-1127+BL-1140 are green.
  Pack model lines follow BL-1140 steward winner or no-winner-yet — never
  human-operator-priority:ollama-local-qwen-20260825 as authoritative
  outrank. Do not thrash to qwen-forge without a separate explicit ask.
  Keep the slice small: verified switch + durable runbook/evidence.
  Success is stable tool use and autonomy under latency, not instant
  replies. Source: human Cursor prioritize intake
  backlog/INTAKE-prioritize-local-ollama-remaining-20260825.md.

  Background:
    Given BL-1126 BL-1127 and BL-1140 are green on this host
    And the human authorized a day-shift cold-swap to the local Ollama mono-router

  # BL-1143 day-shift-is-local-mono-router-01
  Scenario: after cold-swap the live day-shift is the local Ollama mono-router
    When the authorized cold-swap completes
    Then the live day-shift pack is ollama-qwen3-mono-router via start-swarm-ollama-qwen
    And evidence records a successful launch under the BL-1127 staffing gate

  # BL-1143 pack-follows-steward-winner-02
  Scenario: pack models follow BL-1140 steward winner or refuse no-winner-yet
    Given steward has a winner or no-winner-yet state from BL-1140
    When the cold-swapped pack is inspected
    Then model lines match the steward winner or clearly refuse no-winner-yet
    And human-operator-priority:ollama-local-qwen-20260825 is not an authoritative outrank

  # BL-1143 no-qwen-forge-thrash-03
  Scenario: cold-swap does not thrash to qwen-forge
    When the authorized cold-swap runs
    Then qwen-forge or Token Plan full forge is not launched by this ticket
    And a how-to or runbook documents the switch and rollback
