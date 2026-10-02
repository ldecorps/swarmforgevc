Feature: BL-1887 A git_handoff at a commit already on origin/main starts the ticket on a fresh line

  BL-1871 moves a role onto the parcel's commit when it takes up a
  git_handoff, and stays put when its head already descends from that
  commit. A Work note to the coder starts the ticket fresh instead, because
  a long-lived line always descends from origin/main and would wrongly
  stay. The coordinator also routes new work as a git_handoff at main's
  head (BL-1872 at 095f2827a7 on 2026-10-02), and that path took the
  take-up branch: the coder stayed on BL-1877's line, carrying BL-1877's
  unlanded work into BL-1872. A git_handoff whose commit is already on
  origin/main now starts its ticket the way a Work note does.

  Background:
    Given a fixture repository with origin, a coder worktree, and the parcel-line take-up

  # BL-1887 a-route-at-a-main-commit-starts-fresh-01
  Scenario: a git_handoff for a new ticket at a main commit moves the coder off another ticket's line
    Given the coder's line carries BL-9001's unlanded commit on top of origin/main
    When the coder takes up a git_handoff for BL-9002 at a commit already on origin/main
    Then the coder's branch is at origin/main
    And the head it left is kept under a parcel-backup ref

  # BL-1887 a-handed-off-build-is-still-taken-up-02
  Scenario: a git_handoff at a commit not on origin/main is still taken up as before
    Given the coder's line carries BL-9001's unlanded commit on top of origin/main
    When the coder takes up a git_handoff for BL-9002 at a BL-9002 commit not on origin/main
    Then the coder's branch is at that BL-9002 commit

  # BL-1887 the-ticket's-own-line-stays-03
  Scenario: a git_handoff at a main commit for the ticket the line already carries leaves it in place
    Given the coder's line carries BL-9002's unlanded commit on top of origin/main
    When the coder takes up a git_handoff for BL-9002 at a commit already on origin/main
    Then the coder's branch is unchanged
