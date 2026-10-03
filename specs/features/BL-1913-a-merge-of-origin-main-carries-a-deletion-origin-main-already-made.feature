Feature: BL-1913 A merge of origin/main is not refused for a deletion that origin/main already made

  check_merge_deletion.sh refuses a merge whose result lacks a path the
  receiving branch had, unless the message names that path's ticket. When
  the incoming side is origin/main, every such path is one origin/main
  deleted after the receiving line was cut: a deletion that has already
  landed. The guard still refuses it. On 2026-10-03 that sent three
  clean parcel lines off BL-1901's merge path, each of which merged
  without a conflict, and roles syncing their own lines with origin/main
  work round it by naming tickets in their merge messages. A deletion
  made by any branch that is not on origin/main is still refused, as
  BL-1242 and BL-1341 require.

  Background:
    Given a fixture project with a bare origin, the repository's commit hooks, and a line for BL-9001 cut from origin/main
    And origin/main carried a non-ticket file introduced by BL-9002 when the line was cut

  # BL-1913 a-deletion-origin-main-made-is-carried-01
  Scenario: merging origin/main into a line carries origin/main's own deletion
    Given origin/main has since deleted that file
    When the line merges origin/main with a message that names only BL-9001
    Then the merge commits
    And the merged tree does not carry that file

  # BL-1913 a-deletion-from-a-branch-off-origin-main-is-refused-02
  Scenario: a merge from a branch that is not on origin/main is still refused for a path it deletes
    Given a branch that is not on origin/main has deleted that file
    When the line merges that branch with a message that names only BL-9001
    Then the merge is refused naming that file and BL-9002

  # BL-1913 the-lander-lands-an-older-line-by-merge-03
  Scenario: the lander lands a line cut before a deletion on origin/main by the merge path
    Given origin/main has since deleted that file
    And the lander queue holds an entry for BL-9001 whose line carries only BL-9001 commits
    When the lander sweep runs until the queue is empty
    Then the land record for BL-9001 names the merge path
    And origin/main does not carry that file
