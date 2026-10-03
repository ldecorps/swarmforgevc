Feature: BL-1912 A land-step replay commit runs under the land's own bound, not the generic 60 second subprocess wait

  The land step's tip-pure replay commits through the same wrapper as every
  other git command it runs, so `git commit` gets the generic 60 second
  subprocess wait. The commit runs the repository's pre-commit and
  commit-msg hooks, and on a busy host those took 69 seconds for a commit
  of two evidence files. A replay cut short this way is reported as an
  entangled tip that needs specifier adjudication, and the land stops
  for QA. BL-1901 and BL-1893 both stopped like that on 2026-10-03.
  Nothing was entangled; the hooks needed more time.

  Background:
    Given a fixture project with a bare origin, a lander queue and a commit hook that takes 3 seconds
    And the generic subprocess wait bound is 1 second

  # BL-1912 a-slow-hook-replay-lands-01
  Scenario: a replay whose commit hooks outlast the generic wait lands
    Given the lander queue holds an entry for BL-9001 whose line the land step must rebuild
    When the lander sweep runs until the queue is empty
    Then BL-9001's work is on origin/main
    And the lander log for BL-9001 has no LAND_ESCALATE line

  # BL-1912 a-hook-refusal-still-stops-the-land-02
  Scenario: a replay that a commit hook refuses still stops the land with the hook's own words
    Given the commit hook refuses every commit with "fixture guard: refused"
    And the lander queue holds an entry for BL-9001 whose line the land step must rebuild
    When the lander sweep runs until the queue is empty
    Then origin/main does not carry BL-9001's work
    And the lander log for BL-9001 contains "fixture guard: refused"

  # BL-1912 a-replay-past-the-land-bound-is-a-timeout-03
  Scenario: a replay commit that outlasts the land's own bound is reported as a timeout, not an entangled tip
    Given the land step's commit bound is 1 second
    And the lander queue holds an entry for BL-9001 whose line the land step must rebuild
    When the lander sweep runs until the queue is empty
    Then origin/main does not carry BL-9001's work
    And the lander log for BL-9001 says the replay commit timed out after 1 second
    And the lander log for BL-9001 does not ask for specifier adjudication
