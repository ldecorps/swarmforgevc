Feature: BL-2084 The tuning report's briefing mode prints each local seat's days

  Split from BL-1854 (2026-10-08): the table half. On 2026-09-30 the human
  asked for a Local LLM section in the daily briefing, with telemetry
  trends and a suggestion for using the local model better as a swarm
  role. The documenter writes the briefing and the suggestion. The numbers
  come from a tool, the way the Model scout section's do (BL-1822). The
  tuning report (BL-1851) gets a briefing mode: for each local-model seat,
  one row per day for the last 7 days, as markdown the documenter pastes
  verbatim. The settings changes and spilled model loads under each table
  are BL-2085.

  Background:
    Given a fixture root holding settings records, qwen session records and an Ollama log

  # BL-2084 one-row-per-day-per-seat-01
  Scenario: each local seat gets one row per day of the window
    Given "coder@iq3" made requests on 3 of the last 7 days
    When the tuning report runs with --briefing
    Then the section has a table for "coder@iq3" with one row for each of those 3 days
    And each row reads requests, median time to first token, prefill and decode speed, median output tokens, thinking share, compressions per 10 requests and tool-call failure rate

  # BL-2084 no-local-seat-is-one-line-02
  Scenario: a window in which no local-model seat ran prints one line
    Given no local-model seat made a request in the last 7 days
    When the tuning report runs with --briefing
    Then the section is the single line "No local-model seat ran in the last 7 days."
