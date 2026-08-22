Feature: A rescue never makes orphaned work less durable

  Work that ends up outside any branch - in a stash with no worktree, or
  loose in a tree - eventually gets rescued. On 2026-08-22 a rescue moved a
  reviewed-sound fix out of a stash into another role's uncommitted working
  tree and dropped the stash in the same operation, leaving the only copies
  a dirty tree and a hand-written evidence file. It also told nobody, so the
  role that owned the tree found work it could neither attribute nor sweep.

  A rescue ends in a commit on a branch, releases the source only once that
  commit exists, and tells whoever owns the tree it touched.

  Background:
    Given orphaned work that exists outside any branch

  # BL-1041 a-rescue-never-makes-orphaned-work-less-durable-01
  Scenario: a rescue ends in a commit, not in a dirty tree
    When the work is rescued
    Then a commit on a branch contains the rescued content
    And no working tree is left carrying it as an uncommitted change

  # BL-1041 a-rescue-never-makes-orphaned-work-less-durable-02
  Scenario: the source is released only after the commit exists
    When the rescue is interrupted before the commit is made
    Then the source copy is still present
    And the work is still recoverable without it

  # BL-1041 a-rescue-never-makes-orphaned-work-less-durable-03
  Scenario: the owner of a touched worktree is told
    Given the rescue touches a role's worktree
    When the work is rescued
    Then that role is told what landed and why

  # BL-1041 a-rescue-never-makes-orphaned-work-less-durable-04
  Scenario: a role committing its own work is unaffected
    Given a role with its own uncommitted work for its own ticket
    When that role commits it
    Then no rescue behaviour is triggered
