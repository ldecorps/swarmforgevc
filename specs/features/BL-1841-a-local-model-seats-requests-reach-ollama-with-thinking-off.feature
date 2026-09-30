Feature: BL-1841 A local-model seat's requests reach Ollama with thinking off

  The coder@iq3 seat's model is meant to answer without a reasoning pass:
  its Modelfile and its qwen provider entry both say think false. On
  2026-09-30 every request the seat sent still carried reasoning tokens
  (qwen's usage record: 23 to 3,060 thoughtsTokens per request), and the
  Ollama server log shows the chat template loaded with "thinking = 1" and
  <think> blocks in the output. The think false the provider entry sends
  is not the field this Ollama honours on its OpenAI-compatible endpoint.
  The qwen settings the swarm writes for a local-model seat now send the
  field Ollama does honour.

  # BL-1841 the-seat-request-carries-the-honoured-no-think-field-01
  Scenario: the request the seat sends carries the field that turns thinking off
    Given a local-model seat whose model "ista-iq3s-coder:latest" Ollama serves with num_ctx 49152
    And the swarm has written the seat's qwen settings
    When qwen in the seat's worktree sends a chat request to a loopback fake endpoint
    Then the request body carries the thinking-off field the swarm's Ollama version honours

