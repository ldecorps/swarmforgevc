Feature: A duplicate ticket id is refused at mint, keyed on the id field
  Two sessions minting in parallel can pick the same next id, because the id is
  chosen by hand from whatever the miner can see and nothing checks it. Git does
  not catch it: a ticket's filename carries its slug, so two DIFFERENT tickets
  under one id land as two differently-named files and merge with no conflict at
  all. The two live collisions were both caught incidentally, by an add/add
  conflict on the bot-written backlog/topics/<id>.json - a detector that only
  fires when the topic-record automation happened to run on both sides.

  The specifier already runs swarmforge/scripts/specifier_backlog_hygiene_gate.sh
  on every ticket written in a turn, so that is where the refusal belongs: the
  live call site exists and needs no new one.

  Background:
    Given a backlog corpus the hygiene gate reads ticket ids from

  # BL-1105 duplicate-id-refused-01
  Scenario: The check keys on the id field, never on the filename slug
    Given the corpus already contains "BL-4242-one-slug.yaml" with id "BL-4242"
    When the specifier runs the hygiene gate on "BL-4242-a-completely-different-slug.yaml" with id "BL-4242"
    Then the gate fails
    And the output reports a duplicate ticket id

  # BL-1105 duplicate-id-refused-02
  Scenario Outline: A second ticket claiming a live id is refused, whatever pool holds the first
    Given the corpus already contains a ticket with id "BL-4242" in "<pool>"
    When the specifier runs the hygiene gate on a new ticket whose id is "BL-4242"
    Then the gate fails
    And the output reports a duplicate ticket id
    And the output names both files holding that id

    Examples:
      | pool   |
      | paused |
      | active |
      | hold   |
      | done   |

  # BL-1105 duplicate-id-refused-03
  Scenario: An id already published by a parallel session is refused before the merge
    Given the corpus does not contain "BL-4242" locally
    And the published corpus contains a ticket with id "BL-4242"
    When the specifier runs the hygiene gate on a new ticket whose id is "BL-4242"
    Then the gate fails
    And the output reports a duplicate ticket id

  # BL-1105 duplicate-id-refused-04
  Scenario: A unique id passes, and the existing epic and milestone checks still run
    Given the corpus does not contain "BL-4242" locally
    And the published corpus does not contain "BL-4242"
    When the specifier runs the hygiene gate on a new ticket whose id is "BL-4242"
    Then the gate passes
    And a ticket missing its epic in the same run is still reported

  # BL-1105 duplicate-id-refused-05
  Scenario: An unreadable published corpus fails the check closed, never silently clean
    Given the corpus does not contain "BL-4242" locally
    And the published corpus cannot be read
    When the specifier runs the hygiene gate on a new ticket whose id is "BL-4242"
    Then the gate fails
    And the output says the published corpus could not be read
