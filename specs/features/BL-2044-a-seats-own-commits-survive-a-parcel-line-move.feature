Feature: BL-2044 A seat's own commits survive a parcel-line move

  BL-1871's take-up moves a role's worktree onto a parcel's line, and runs
  again every time an in-process Work note is served. Until 2026-10-06 it
  kept a coder's line only when every commit past origin/main named the
  ticket alone, so a merge of main under git's default subject, a merge of
  a salvage ref, or a landed ticket's commit made the line look foreign,
  and the next serve moved it to origin/main. The coder's BL-1843 line was
  moved six times that day; each time the work survived only under a
  parcel-backup ref nobody re-applied. Hotfix 24872ac7a9 keeps such a line.
  A line that really must move, because it carries an unlanded other
  ticket's work, now takes the ticket's own commits to the new start.

  Background:
    Given a coder worktree whose line is cut from origin/main

  # BL-2044 a-merge-and-a-landed-commit-keep-the-line-01
  Scenario: a merge naming no ticket and a done ticket's commit keep the coder on its line
    Given the line carries a commit naming BL-9002, a commit naming done ticket BL-9005, and a merge of origin/main under git's default subject
    When the coder is served its Work note for BL-9002 again
    Then the coder's worktree HEAD is unchanged

  # BL-2044 the-tickets-own-commits-follow-the-move-02
  Scenario: a line carrying an unlanded other ticket's work moves, and the ticket's own commits are re-applied
    Given the line carries a commit naming BL-9002 and a commit naming unlanded ticket BL-9000
    When the coder is served its Work note for BL-9002 again
    Then the coder's worktree HEAD descends from origin/main
    And the commit naming BL-9002 is re-applied on it and the commit naming BL-9000 is not
    And the head it left is kept under a parcel-backup ref

  # BL-2044 a-conflicting-re-apply-moves-nothing-03
  Scenario: a re-application that conflicts leaves the line where it was
    Given the line carries a commit naming BL-9002 that conflicts with origin/main and a commit naming unlanded ticket BL-9000
    When the coder is served its Work note for BL-9002 again
    Then the coder's worktree HEAD is unchanged and has no merge or cherry-pick in progress
    And the output says the parcel was not taken up and names the conflicting commit
