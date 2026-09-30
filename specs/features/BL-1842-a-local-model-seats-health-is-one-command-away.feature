Feature: BL-1842 A local-model seat's health is one command away

  On 2026-09-30 the coordinator read the coder@iq3 seat as stuck: near 0%
  CPU, the same pane lines repeating, no commits. The seat was in fact
  generating at 3.5 tokens/s with 8 of 65 layers on the CPU, then later
  compressing its chat every turn. The facts were all on disk, in qwen's
  usage and session records and in the Ollama server log, and it took a
  hand trace to find them. A report now reads them for a seat and prints
  what the seat is doing, so a role judges a local seat from its measured
  turns rather than from its pane.

  Background:
    Given a fixture root with a qwen usage record, a qwen session record and an Ollama server log for the seat "coder@iq3"

  # BL-1842 the-report-summarises-each-session-01
  Scenario: the report summarises the seat's latest session from its records
    Given the latest session sent 6 requests, with 2 chat compressions and 1 api error
    When the local-seat report runs for "coder@iq3"
    Then it prints the session's request count as 6
    And it prints 2 compressions and 1 api error
    And it prints the session's total output tokens and reasoning tokens

  # BL-1842 the-report-reads-the-served-model-from-the-ollama-log-02
  Scenario: the report prints how the model is served
    Given the Ollama log's latest load offloaded 57 of 65 layers with a 49152 context and an f16 KV cache
    And its latest generation ran at 3.5 tokens per second
    When the local-seat report runs for "coder@iq3"
    Then it prints "57/65 layers on GPU", the 49152 context, the f16 KV cache and 3.5 tokens per second

  # BL-1842 a-seat-mid-request-reads-as-generating-not-stuck-03
  Scenario: a seat whose model is generating reads as generating, not stuck
    Given the seat's last recorded request finished 6 minutes ago
    And the Ollama log shows a generation in progress within the last minute
    When the local-seat report runs for "coder@iq3"
    Then it reports the seat as "generating"
