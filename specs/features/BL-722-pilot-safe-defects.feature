Feature: /pilot safe picks only low-blast specced defects
  Offline pilot can auto-select from a safe pool: defect, real feature file,
  not needs_design, approved, mutation_cost low, paused. Empty pool refuses.
  Source: human via Let's Talk / Cursor 2026-07-30; BL-722.

  Background:
    Given a repo backlog with paused ticket YAML and specs/features

  # BL-722 safe-01
  Scenario: safe list includes only matching defects
    Given a paused approved defect with mutation_cost low and a real feature file
    And a paused approved defect with mutation_cost medium
    And a paused approved defect with status needs_design and mutation_cost low
    When I list the safe pilot pool
    Then only the first ticket appears

  # BL-722 safe-02
  Scenario: safe start picks the top-ranked ticket
    Given two paused safe defects differing by severity and priority
    When I start /pilot safe
    Then the selected ticket is the higher-severity then lower-priority one
    And the selection rationale names the safe filter

  # BL-722 safe-03
  Scenario: empty safe pool does not start pilot
    Given no paused ticket matches the safe filter
    When I start /pilot safe
    Then no pilot run starts
    And the operator is told the pool is empty

  # BL-722 safe-04
  Scenario: explicit pilot by id still works
    When I run /pilot BL-650
    Then the pilot targets BL-650 regardless of the safe filter
