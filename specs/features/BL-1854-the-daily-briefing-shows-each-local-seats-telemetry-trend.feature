Feature: BL-1854 The daily briefing shows each local seat's telemetry trend

  On 2026-09-30 the human asked for a Local LLM section in the daily
  briefing, with telemetry trends and a suggestion for using the local
  model better as a swarm role. The documenter writes the briefing and the
  suggestion. The numbers come from a tool, the way the Model scout
  section's do (BL-1822), because a briefing's author never computes them.
  The tuning report (BL-1851) now has a briefing mode. For each
  local-model seat it prints one row per day for the last 7 days, and
  lists the settings changes and the model loads that spilled out of VRAM
  in that window, as markdown the documenter pastes verbatim.

  Background:
    Given a fixture root holding settings records, qwen session records and an Ollama log

  # BL-1854 one-row-per-day-per-seat-01
  Scenario: each local seat gets one row per day of the window
    Given "coder@iq3" made requests on 3 of the last 7 days
    When the tuning report runs with --briefing
    Then the section has a table for "coder@iq3" with one row for each of those 3 days
    And each row reads requests, median time to first token, prefill and decode speed, median output tokens, thinking share, compressions per 10 requests and tool-call failure rate

  # BL-1854 settings-changes-are-listed-02
  Scenario: a settings change in the window is listed under the seat's table
    Given "coder@iq3" has a settings row at 2026-09-30 21:28 lowering the GPU power limit from 180 W to 150 W
    When the tuning report runs with --briefing
    Then the section lists "2026-09-30 21:28 GPU power limit 180 W -> 150 W" under the table for "coder@iq3"

  # BL-1854 a-spilled-load-is-listed-03
  Scenario: a model load that did not fit in VRAM is listed
    Given the Ollama log loaded the seat's model with 57 of 65 layers on the GPU on 2026-09-30
    When the tuning report runs with --briefing
    Then the section lists that load as "57/65 layers on GPU" with its date

  # BL-1854 no-local-seat-is-one-line-04
  Scenario: a window in which no local-model seat ran prints one line
    Given no local-model seat made a request in the last 7 days
    When the tuning report runs with --briefing
    Then the section is the single line "No local-model seat ran in the last 7 days."
