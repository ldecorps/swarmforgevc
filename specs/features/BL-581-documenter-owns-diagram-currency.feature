Feature: documenter owns diagram currency with per-diagram change-triggers

  # BL-581 (epic swarm-reliability). The documenter must own diagram currency:
  # when a parcel changes a mechanism that a registered diagram depicts,
  # updating that diagram is part of the SAME parcel, not a follow-up ticket.
  # Each diagram gets an explicit change-trigger sentence naming what kind of
  # change obliges an update, giving the documenter something it can actually
  # check and QA something it can bounce on.

  Background:
    Given the constitution lists maintained diagrams with change-triggers

  # BL-581 documenter-responsibility-01
  Scenario: The documenter's responsibilities include diagram currency
    When 01_roles.md section 1.7 is read
    Then the documenter's responsibilities include diagram currency
    And the responsibilities state the update belongs in the same parcel as the change

  # BL-581 per-diagram-change-trigger-02
  Scenario: Every diagram in DIAGRAM_FILES has a change-trigger in the constitution
    Given a diagram is present in render-briefing-diagrams.ts's DIAGRAM_FILES allowlist
    When local-engineering.prompt's Diagrams section is read
    Then the diagram has an entry with a distinct change-trigger sentence

  # BL-581 no-count-encoding-03
  Scenario: The Diagrams section does not encode a diagram count
    When local-engineering.prompt's Diagrams section is read
    Then no wording in that section encodes a diagram count

  # BL-581 registry-match-04
  Scenario: DIAGRAM_FILES and the constitution diagram list match
    Given the DIAGRAM_FILES allowlist from render-briefing-diagrams.ts
    And the diagram list from local-engineering.prompt's Diagrams section
    When they are compared
    Then every diagram in DIAGRAM_FILES has an entry in the constitution
    And every diagram in the constitution is in DIAGRAM_FILES
