Feature: BL-1382 A crontab line the swarm did not write is never the swarm's to remove

  Two predicates decide whether a crontab line belongs to a project root: the
  shell library every cron installer and uninstaller sources, and the strip
  step inside the schedule reconcile. Both claim any line that merely names a
  script under the root's .swarmforge/operator/ directory, so a schedule the
  human installed by hand is erased by a full-stack stop or by a recognized
  mode install. This feature is that ownership follows the markers the swarm
  writes, an unmarked line is reported and left in place, and the two
  readers agree on one rule.

  Background:
    Given a fixture project root "R" with the swarmforge scripts
    And a sibling fixture root "S"
    And a crontab shim that reads and writes a fixture crontab file
    And the fixture crontab holds a freshness line marked for "R"
    And the fixture crontab holds an unmarked line naming "R/.swarmforge/operator/day-shift-start.sh"
    And the fixture crontab holds an unmarked line naming "R/swarmforge/scripts/wait.sh"
    And the fixture crontab holds a freshness line marked for "S"

  # BL-1382 a-full-stack-stop-removes-only-marked-lines-01
  # Assumes ruling option 1; RETIRE-WITH: ruling option 2 (never reword).
  Scenario: a full-stack stop removes only the lines it marked
    When the swarm cron lines for "R" are uninstalled
    Then the freshness line marked for "R" is gone
    And the unmarked line naming "R/.swarmforge/operator/day-shift-start.sh" is present byte-identical
    And the unmarked line naming "R/swarmforge/scripts/wait.sh" is present byte-identical
    And the freshness line marked for "S" is present byte-identical

  # BL-1382 a-schedule-install-leaves-unmarked-lines-02
  Scenario: a recognized mode install adds its block without touching unmarked lines
    Given the fixture conf for "R" sets swarm_shift to "day"
    When the schedule cron is installed for "R"
    Then the fixture crontab holds the managed block for "R"
    And the unmarked line naming "R/.swarmforge/operator/day-shift-start.sh" is present byte-identical
    And the unmarked line naming "R/swarmforge/scripts/wait.sh" is present byte-identical
    And the output reports the unmarked line naming "R/.swarmforge/operator/day-shift-start.sh" as left in place

  # BL-1382 a-marked-legacy-line-is-still-the-swarms-03
  Scenario: a line carrying the operator schedule marker is still removed
    Given the fixture crontab holds a line carrying the operator schedule marker for "R"
    When the swarm cron lines for "R" are uninstalled
    Then the line carrying the operator schedule marker for "R" is gone

  # BL-1382 an-unmarked-line-is-reported-not-swept-04
  # Assumes ruling option 1; RETIRE-WITH: ruling option 2 (never reword).
  Scenario: the uninstall reports each unmarked line it left in place
    When the swarm cron lines for "R" are uninstalled
    Then the output reports the unmarked line naming "R/.swarmforge/operator/day-shift-start.sh" as left in place

  # BL-1382 both-readers-decide-by-one-rule-05
  Scenario: the shell predicate and the reconcile strip agree on every line of a shared corpus
    Given a corpus of crontab lines mixing marked, unmarked and sibling-root lines
    When each line is classified by the shell predicate and by the reconcile strip
    Then every line receives the same ownership from both
