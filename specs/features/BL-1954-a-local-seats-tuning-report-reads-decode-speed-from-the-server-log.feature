Feature: BL-1954 A local seat's tuning report reads decode speed from the server log
  A local-model seat's replies reach qwen through the tool-call shim, which
  asks Ollama without streaming and hands the whole reply back in one burst.
  qwen's time to first token then covers the whole generation, so speeds
  computed from the client's telemetry are meaningless for those replies.
  The report reads decode speed from llama-server's own eval rates in the
  server log, and prints what no record can support as unknown.

  Background:
    Given a fixture seat whose qwen telemetry holds one settings group served by one Ollama load

  # BL-1954 one-burst-reply-01
  Scenario: a reply that came back in one burst prints its time to first token and prefill speed as unknown
    Given a reply record with a time to first token of 6547 ms, a duration of 6557 ms and 74 output tokens
    When the tuning report runs for the seat
    Then the group's median time to first token prints as unknown
    And the group's median prefill speed prints as unknown
    And the group's one-burst reply count is 1

  # BL-1954 server-decode-02
  Scenario: the group's decode speed is the median of the server log's eval rates for its load
    Given a reply record with a time to first token of 6547 ms, a duration of 6557 ms and 74 output tokens
    And the load's server log carries an eval rate of 23.8 tokens per second
    And the load's server log carries an eval rate of 26.3 tokens per second
    When the tuning report runs for the seat
    Then the group's median decode speed prints 25.05 tokens per second

  # BL-1954 streamed-reply-03
  Scenario: a streamed reply keeps its own time to first token
    Given a reply record with a time to first token of 2000 ms, a duration of 6000 ms and 100 output tokens
    When the tuning report runs for the seat
    Then the group's median time to first token prints 2.0 seconds
    And the group's one-burst reply count is 0
