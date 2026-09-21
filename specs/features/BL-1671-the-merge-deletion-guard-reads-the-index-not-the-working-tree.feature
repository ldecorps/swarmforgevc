Feature: BL-1671 The merge-deletion guard reads the index, not the working tree

  check_merge_deletion.sh refuses a merge commit that drops a path the
  receiving or incoming branch introduced unless the merge message names
  the path's ticket (BL-1242, BL-1341, BL-1662). It computed its deletion
  set with git diff --name-status -M <parent>, which compares the WORKING
  TREE to the parent, so a tracked file deleted on disk but never staged -
  no part of the merge commit - read as a deletion the merge makes. On
  2026-09-21 that refused the daemon's master-main reconcile twice on the
  shared checkout, tripped the main-sync deadlock latch and paged the
  human. This feature is that the guard judges the index against each
  parent: an unstaged working-tree deletion is not a finding and survives
  the merge untouched, while a path the merge result drops is refused
  exactly as before.

  Background:
    Given a fixture repository initialised under mkdtemp with the commit guard chain installed and two branches that both carry keep.txt, committed under a subject naming BL-0001

  # BL-1671 merge-deletion-guard-reads-the-index-01
  Scenario Outline: the guard's finding set comes from the index, not the working tree
    Given keep.txt is <state>
    When the other branch is merged with --no-ff and a message naming no ticket
    Then <outcome>

    Examples:
      | state                                      | outcome                                                    |
      | deleted in the working tree but not staged | the merge commits and the guard names no path              |
      | deleted by a commit on the other branch    | the merge is refused naming keep.txt and BL-0001           |

  # BL-1671 merge-deletion-guard-reads-the-index-02
  Scenario: an unstaged working-tree deletion survives the merge untouched
    Given keep.txt is deleted in the working tree but not staged
    When the other branch is merged with --no-ff and a message naming no ticket
    Then the merge commit's tree still carries keep.txt
    And git status still shows keep.txt deleted and unstaged

  # BL-1671 merge-deletion-guard-reads-the-index-03
  # Census pin (BL-1445): the test prints one PASS line per case, so the
  # new case is named literally; a runner that silently lost it would still
  # report all passed.
  Scenario: the guard's own shell test carries the unstaged-deletion case
    When the merge deletion guard shell test runs
    Then it reports every check passed
    And its passing checks include unstaged-worktree-deletion-is-not-a-finding
