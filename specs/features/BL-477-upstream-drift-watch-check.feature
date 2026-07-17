Feature: Upstream drift-watch check
  This heavily-diverged fork of unclebob/swarm-forge adopts upstream changes only
  through a deliberate drift-watch review (local-engineering.prompt rule 2), never
  by automatic fetch. The drift-check reads a watch file that records, per upstream
  repo and branch, the last-REVIEWED commit SHA (the baseline "we have looked at
  everything up to here"), compares it against the live upstream heads, and reports
  any drift so a human knows where to look. It is strictly read-only: it never
  fetches into the working tree, rewrites the watch file, or bumps a pin — advancing
  a watch SHA is always a human commit.

  Background:
    Given a watch file recording, per upstream repo and branch, the last-reviewed commit SHA

  # BL-477 upstream-drift-watch-01
  Scenario: a watched branch that advanced past the recorded SHA is reported as drift
    Given the watch file records upstream "swarm-forge" branch "main" at a recorded SHA
    And the live "swarm-forge" branch "main" head is a different, newer SHA
    When the drift check runs
    Then the report lists "swarm-forge" branch "main" as drifted from the recorded SHA to the live head
    And the drift check exits non-zero

  # BL-477 upstream-drift-watch-02
  Scenario: a watched branch whose head equals the recorded SHA reports no drift
    Given the watch file records upstream "swarm-forge" branch "main" at a recorded SHA
    And the live "swarm-forge" branch "main" head equals that recorded SHA
    When the drift check runs
    Then the report lists no drift for "swarm-forge" branch "main"
    And the drift check exits zero

  # BL-477 upstream-drift-watch-03
  Scenario: a new upstream branch absent from the watch file is reported as drift
    Given the watch file has no entry for upstream "swarm-forge" branch "adversaries"
    And the live "swarm-forge" repo has a branch "adversaries"
    When the drift check runs
    Then the report lists "swarm-forge" branch "adversaries" as a new upstream branch
    And the drift check exits non-zero

  # BL-477 upstream-drift-watch-04
  Scenario: the drift check is read-only and never rewrites the watch file or bumps a pin
    Given the watch file records upstream "swarm-forge" branch "main" at a recorded SHA
    And the live "swarm-forge" branch "main" head is a different, newer SHA
    When the drift check runs
    Then the watch file on disk is byte-for-byte unchanged
    And no install pin is modified
