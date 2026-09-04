Feature: BL-1403 The merge-deletion guard never reports a move and never refuses unexemptably

  The guard refuses a merge that drops a path either parent carries unless
  the message names the path's ticket. Two gaps made one unexemptable block:
  a moved path was reported as a deletion, and attribution asked the incoming
  side only when HEAD's subject was empty, so a raw intake - whose introducing
  commit names no ticket by design - refused with no id any message could
  name. This feature is that a path whose content survives elsewhere is not a
  deletion, and that a refusal carries the id from whichever side has one.

  Background:
    Given a fixture repository whose first branch committed a raw intake with a subject naming no ticket

  # BL-1403 a-moved-path-is-not-a-deletion-01
  Scenario Outline: a path moved on the incoming branch is not reported as dropped
    Given the incoming branch moved the intake into the archive <how>
    When the merge commit message names no ticket
    Then the merge commit is allowed

    Examples:
      | how                       |
      | unchanged                 |
      | with a footer appended    |

  # BL-1403 a-real-deletion-is-still-reported-02
  Scenario: a path deleted outright on the incoming branch is still reported
    Given the incoming branch deleted the intake in a commit naming ticket "BL-9009"
    When the merge commit message names no ticket
    Then the merge commit is refused

  # BL-1403 the-refusal-carries-the-incoming-sides-id-03
  Scenario: the refusal names the incoming side's ticket and commit, never unattributed
    Given the incoming branch deleted the intake in a commit naming ticket "BL-9009"
    When the merge commit message names no ticket
    Then the refusal names ticket "BL-9009" and the deleting commit
    And the refusal does not say unattributed

  # BL-1403 naming-the-incoming-sides-id-allows-the-merge-04
  Scenario: naming the incoming side's ticket in the message allows the merge
    Given the incoming branch deleted the intake in a commit naming ticket "BL-9009"
    When the merge commit message names "BL-9009"
    Then the merge commit is allowed

  # BL-1403 no-id-on-either-side-still-refuses-05
  Scenario: a path no commit on either side attributes still refuses as unattributed
    Given the incoming branch deleted the intake in a commit naming no ticket
    When the merge commit message names no ticket
    Then the merge commit is refused
    And the refusal says unattributed
