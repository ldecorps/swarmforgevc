Feature: BL-1840 A local-model seat's qwen compresses its chat only when the history nears the served window

  qwen summarises its own chat history when it thinks the history is too
  long, in one extra, unrecorded request to the model. On 2026-09-30 the
  coder@iq3 seat, served a 49152-token window, compressed at 12:59, 13:04
  and 13:09Z, each time for "token_limit" at about 17,500 tokens of
  history, and each saved about 80 tokens (17,539 to 17,459). Each
  compression was a 6,000 to 8,400-token reply, about five minutes at the
  seat's 24 tokens/s, so almost every turn of the seat's work took five
  minutes. The qwen settings the swarm writes for a local-model seat now
  set when compression fires, as a share of the window its model is
  served with.

  # BL-1840 the-seat-settings-name-a-compression-threshold-01
  Scenario Outline: the seat's qwen settings set compression at a share of the served window
    Given a local-model seat whose model "ista-iq3s-coder:latest" Ollama serves with num_ctx <served>
    When the swarm writes the seat's qwen settings
    Then the worktree's qwen settings compress the chat only above <threshold> tokens of history

    Examples:
      | served | threshold |
      | 32768  | 26214     |
      | 49152  | 39321     |

  # BL-1840 a-history-below-the-threshold-is-not-compressed-02
  Scenario: a history below the threshold is sent without a compression request
    Given a local-model seat whose model "ista-iq3s-coder:latest" Ollama serves with num_ctx 49152
    And the swarm has written the seat's qwen settings
    And qwen runs in the seat's worktree against a loopback fake endpoint with a 20,000-token history
    When qwen sends its next turn
    Then the fake endpoint receives no compression request
