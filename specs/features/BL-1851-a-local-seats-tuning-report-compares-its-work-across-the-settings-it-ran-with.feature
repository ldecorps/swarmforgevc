Feature: BL-1851 A local seat's tuning report compares its work across the settings it ran with

  The human asked on 2026-09-30 whether coder@iq3 could be instrumented to
  show how to tweak it. Most of the numbers were already on disk: qwen's
  session records carry every request's time to first token, duration,
  tokens and tool calls, and every chat compression; the Ollama log carries
  each model load's layers on the GPU and KV cache type. BL-1850 records
  the settings a seat starts with, and any row written by hand after a
  change made outside the swarm, such as the GPU power limit the human
  lowered mid-session that evening. This report puts them side by side:
  requests grouped by the settings in force when each one ran, and by how
  Ollama actually served the model, with each group's numbers and what
  differs between groups, so a settings change can be judged before and
  after from the seat's real work.

  Background:
    Given a fixture root holding a settings record, qwen session records and an Ollama log for the seat "coder@iq3"

  # BL-1851 requests-group-by-the-settings-they-ran-under-01
  Scenario: requests are grouped by the settings in force when each ran, even within one session
    Given one session's first 12 requests ran before a settings row lowering the GPU power limit from 180 W to 150 W, and its last 8 after it
    When the tuning report runs for "coder@iq3"
    Then it prints two groups, of 12 requests and 8 requests
    And it names "GPU power limit 180 W -> 150 W" as the difference between them

  # BL-1851 a-group-prints-its-turn-numbers-02
  Scenario: a group prints its time to first token, prefill and decode speed, output and thinking
    Given a request in the group took 10000 ms to first token and 30000 ms in all, with 12000 input, 480 output and 120 thinking tokens
    And a request in the group took 20000 ms to first token and 60000 ms in all, with 16000 input, 960 output and 240 thinking tokens
    And a request in the group took 40000 ms to first token and 100000 ms in all, with 24000 input, 1200 output and 600 thinking tokens
    When the tuning report runs for "coder@iq3"
    Then the group reads median time to first token 20 s, prefill 800 tokens/s and decode 24 tokens/s
    And the group reads median output 960 tokens with thinking at 25% of output

  # BL-1851 a-group-prints-its-compressions-and-tool-failures-03
  Scenario: a group prints its chat compressions and tool-call failures
    Given one group's 40 requests came with 4 chat compressions, each from 18000 to 16000 tokens
    And they came with 20 tool calls, of which 3 failed, 2 of them "edit"
    When the tuning report runs for "coder@iq3"
    Then the group reads 1 compression per 10 requests saving 2000 tokens each
    And the group reads a tool-call failure rate of 15% with "edit" failing most

  # BL-1851 how-ollama-served-the-model-splits-a-group-04
  Scenario: requests under the same settings are split by how Ollama served the model
    Given every request ran under the same settings
    And the Ollama log loaded the model with 57 of 65 layers on the GPU and an f16 KV cache before the first 5 requests, and with 65 of 65 and a q8_0 KV cache before the other 5
    When the tuning report runs for "coder@iq3"
    Then it prints two groups under those settings, served as "57/65 layers, f16 KV" and "65/65 layers, q8_0 KV"

  # BL-1851 requests-before-any-record-are-unrecorded-05
  Scenario: a request made before the first settings row is grouped as unrecorded
    Given a request ran before the settings record's first row
    When the tuning report runs for "coder@iq3"
    Then that request is grouped under "unrecorded settings"
