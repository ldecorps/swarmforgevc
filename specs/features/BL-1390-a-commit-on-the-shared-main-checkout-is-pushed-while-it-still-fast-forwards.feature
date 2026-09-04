Feature: BL-1390 A commit on the shared main checkout is pushed while it still fast-forwards

  Every writer on the shared main checkout leaves local main ahead of
  origin, the periodic push sweep refuses once origin has moved, and from
  then on every QA landing is a merge that only a clean verdict may make
  and no role may resolve. This feature is that a commit on main is pushed
  at once while a fast-forward is still possible, through the one existing
  push adapter, and never otherwise: never while diverged, never by force,
  never from a role worktree, and never at the cost of the commit itself.

  Background:
    Given a master checkout on main with a reachable origin

  # BL-1390 a-fast-forwardable-commit-is-pushed-at-once-01
  Scenario: a commit made while origin has not moved is pushed immediately
    Given origin/main equals local main
    When a commit is made on main
    Then local main and origin/main are equal after the hook
    And the push went through the push sweep adapter

  # BL-1390 a-diverged-checkout-is-never-pushed-02
  Scenario: a commit made after origin has moved is left for the reconcile
    Given origin/main has advanced by one commit local main lacks
    When a commit is made on main
    Then nothing is pushed
    And the hook logs diverged
    And the commit is intact on local main

  # BL-1390 a-role-worktree-never-pushes-03
  Scenario: a commit on a linked role worktree branch triggers no push
    Given a linked worktree on a role branch
    When a commit is made on that role branch
    Then nothing is fetched or pushed
    And nothing is logged by the hook

  # BL-1390 an-unreachable-origin-costs-a-bounded-wait-04
  Scenario: an unreachable origin never fails or stalls the commit
    Given origin is unreachable
    When a commit is made on main
    Then the commit completes within the hook's bound
    And the hook logs that the push was not attempted
    And nothing is pushed

  # BL-1390 two-quick-commits-both-reach-origin-05
  Scenario: two commits in quick succession both reach origin in order without force
    Given origin/main equals local main
    When two commits are made on main within a second
    Then origin/main equals local main after the second hook
    And no push used force
