Feature: BL-1914 When the merge path cannot merge origin/main into a line, its decline gives git's own reason

  land_merge_path.bb reports every failed `git merge` as "merging
  origin/main into the line conflicts" and discards what git said. On
  2026-10-03 three such declines were a commit hook refusing the merge,
  and none was a conflict: `git merge-tree` merged the first two lines
  cleanly. A wrong reason in the land record sends whoever reads it after
  the wrong cause, and the BL-1870 census counts these reasons.

  Background:
    Given a fixture project with a bare origin and a lander queue
    And origin/main has moved on since BL-9001's line was cut

  # BL-1914 a-conflict-names-the-conflicted-path-01
  Scenario: a line that conflicts with origin/main is declined naming the conflicted path
    Given origin/main and BL-9001's line both changed the same line of "shared.txt"
    And the lander queue holds an entry for BL-9001 whose line carries only BL-9001 commits
    When the lander sweep runs until the queue is empty
    Then the lander log for BL-9001 has a LAND_PATH land-step line naming a conflict in "shared.txt"

  # BL-1914 a-hook-refusal-is-not-called-a-conflict-02
  Scenario: a merge that a commit hook refuses is declined with the hook's words, never as a conflict
    Given a commit-msg hook that refuses every merge with "fixture guard: merge refused"
    And the lander queue holds an entry for BL-9001 whose line carries only BL-9001 commits
    When the lander sweep runs until the queue is empty
    Then the lander log for BL-9001 has a LAND_PATH land-step line containing "fixture guard: merge refused"
    And that LAND_PATH line does not contain "conflicts"
