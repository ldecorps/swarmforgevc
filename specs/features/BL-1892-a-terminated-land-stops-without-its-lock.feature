Feature: BL-1892 A land told to stop releases its lock and stops, but never mid re-point

  land_main_publish.sh traps EXIT, INT and TERM with land_release_trap,
  which releases the land lock but does not exit. A land sent TERM therefore
  carries on afterwards, and if it was mid-sequence it pushes and re-points
  without the lock (found reviewing hotfix 89935d52d0 under BL-1890). Since
  BL-1872 the lander daemon runs lands unattended, so a daemon restart or a
  swarm stop can TERM one. A land told to stop now releases its lock and
  exits, except during the post-land re-point, which it finishes first so
  no branch is left half-moved.

  Background:
    Given a fixture repository with a bare origin and the land publish script

  # BL-1892 a-term-before-the-push-stops-the-land-01
  Scenario: a land sent TERM before it publishes releases the lock and exits without pushing
    Given a land of BL-9001 that has not yet pushed
    When the land is sent TERM
    Then the land exits non-zero
    And the land lock is released
    And origin/main has not changed

  # BL-1892 a-term-during-the-re-point-finishes-it-02
  Scenario: a land sent TERM during the post-land re-point finishes the re-point, then exits
    Given a land of BL-9001 that has published and is re-pointing its branch
    When the land is sent TERM
    Then the re-point completes and the branch is not left half-moved
    And the land lock is released
    And the land exits non-zero
