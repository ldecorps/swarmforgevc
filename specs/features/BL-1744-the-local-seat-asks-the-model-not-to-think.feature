Feature: BL-1744 The local seat asks the model not to think

  The local seat answers the human in a few short sentences that read
  well aloud. On a reasoning-capable model it spent its whole reply budget
  inside a <think> block and never reached an answer. Ollama has its own
  switch for that, the request's think field, and a model that cannot
  think ignores it. The seat's completion request now always turns
  thinking off.

  # BL-1744 the-completion-request-turns-thinking-off-01
  Scenario Outline: every completion request the local seat sends turns thinking off
    Given a stand-in ollama endpoint that records the request it receives
    When the local seat completes a turn <with or without> a system prompt
    Then the recorded request's think field is false
    And the seat returns the endpoint's reply as its answer

    Examples:
      | with or without |
      | with            |
      | without         |
