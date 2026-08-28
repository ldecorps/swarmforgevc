Feature: the shared-repo canary reports on every exit path of a guarded run, including one that was killed

  # BL-1202 (epic swarm-reliability). 2026-08-27 19:37-19:38, cleaner note
  # 000039 and .worktrees/cleaner/backlog/evidence/
  # BL-1188-cleaner-branch-corruption-property-suite-20260827.md. Committing
  # an extension/src/* path fires the pre-commit chain's
  # check_property_suite_drift.sh, which runs the full unscoped
  # `npm run test:properties` (line 97). A client-side 120s timeout killed
  # the foreground git commit while the suite was still running; the suite's
  # own background processes were NOT killed and kept writing for minutes,
  # overwriting swarmforge-cleaner's ref with fixture commits until its tip
  # was "seed", divorced from the real merge d5bf9f5dc. BL-1124's canary,
  # bl1124_assert_unchanged, exists to catch exactly that — but it sits at
  # line 145, sequentially after the suite returns, under a comment reading
  # "Always assert canary after a real suite run (green or red)". Green and
  # red are not the only ways a run ends. The file contains no trap, so a
  # killed run skips the canary entirely and the corruption is never
  # reported by the guard built to report it.

  Background:
    Given the property-suite guard has taken its shared-repo canary baseline

  # BL-1202 canary-reports-when-the-run-is-killed-01
  Scenario Outline: The canary reports its verdict however the guarded run ends
    Given the guarded suite run ends by <ending>
    And the shared repository was mutated during that run
    When the guard finishes
    Then the canary verdict is reported

    Examples:
      | ending          |
      | being killed    |
      | failing         |
      | passing         |

  # BL-1202 no-suite-process-outlives-the-guard-02
  Scenario: A killed guarded run leaves no suite process still able to write
    Given the guarded suite run has been killed
    When the guard finishes
    Then no process started by that suite run is still running
