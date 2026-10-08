Feature: BL-2085 The tuning report's briefing lists settings changes and spilled loads

  Split from BL-1854 (2026-10-08): the lines under each table. BL-2084's
  briefing mode prints one row per day for each local-model seat. Under
  each seat's table it now also lists the seat's settings changes in the
  window and every model load in the window that put layers outside VRAM,
  so the documenter's suggestion can name what changed beside the trend.

  Background:
    Given a fixture root holding settings records, qwen session records and an Ollama log

  # BL-2085 settings-changes-are-listed-01
  Scenario: a settings change in the window is listed under the seat's table
    Given "coder@iq3" has a settings row at 2026-09-30 21:28 lowering the GPU power limit from 180 W to 150 W
    When the tuning report runs with --briefing
    Then the section lists "2026-09-30 21:28 GPU power limit 180 W -> 150 W" under the table for "coder@iq3"

  # BL-2085 a-spilled-load-is-listed-02
  Scenario: a model load that did not fit in VRAM is listed
    Given the Ollama log loaded the seat's model with 57 of 65 layers on the GPU on 2026-09-30
    When the tuning report runs with --briefing
    Then the section lists that load as "57/65 layers on GPU" with its date
