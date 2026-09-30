Feature: BL-1838 A local-model seat's qwen budgets the window its model is served with

  The qwen CLI compresses and then gives up at its own context budget, the
  provider entry's contextWindowSize, whatever Ollama actually serves. For
  the coder@iq3 seat that entry lived only in the operator's
  ~/.qwen/settings.json, written once by a launcher that adds a missing
  entry and never updates one. On 2026-09-30 the model was re-served at
  num_ctx 49152 while the entry still said 32768, so the seat died at
  "Estimated prompt tokens: 32631; hard limit: 30852.8" with 16k tokens of
  real window unused. The swarm now writes the seat's model entry into the
  worktree's own .qwen/settings.json, beside BL-1829's tool lists, with the
  window its model is served with.

  # BL-1838 qwen-budget-equals-served-window-01
  Scenario Outline: the seat's qwen settings carry the window its model is served with
    Given a local-model seat whose model "ista-iq3s-coder:latest" Ollama serves with num_ctx <served>
    When the swarm writes the seat's qwen settings
    Then the worktree's qwen settings give "ista-iq3s-coder:latest" a context window of <served>

    Examples:
      | served |
      | 32768  |
      | 49152  |

  # BL-1838 no-served-window-falls-back-to-the-swarm-context-length-02
  Scenario: with no served window the swarm's own context length is used
    Given a local-model seat whose model "ista-iq3s-coder:latest" Ollama reports no num_ctx for
    And the swarm's context length is 49152
    When the swarm writes the seat's qwen settings
    Then the worktree's qwen settings give "ista-iq3s-coder:latest" a context window of 49152

  # BL-1838 the-entry-keeps-thinking-off-and-the-six-tools-03
  Scenario: the written settings keep thinking off and BL-1829's six tools
    Given a local-model seat whose model "ista-iq3s-coder:latest" Ollama serves with num_ctx 49152
    When the swarm writes the seat's qwen settings
    Then the entry for "ista-iq3s-coder:latest" sends think false to the loopback endpoint
    And the core tool list is exactly the six BL-1829 tools
