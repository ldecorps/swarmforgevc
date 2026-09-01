Feature: The master-main reconcile never discards a commit it cannot name afterwards

  BL-1310. The reconcile's recovery path ends at `git reset --hard origin/main`.
  Every guard shipped so far narrows WHEN that reset is allowed - BL-1198 makes
  it attempt a push first, BL-1214 makes a non-conflicting divergence merge
  instead, BL-1236 refuses when git cannot answer, BL-1288 requires a genuine
  push rejection - and none of them makes the discard recoverable. On a real
  two-way divergence the push is legitimately rejected, so the reset is
  authorised, and the local-ahead commits survive only as unreachable objects
  in the reflog until `git gc` collects them.

  Background:
    Given a master checkout on main
    And origin/main has advanced with commits local main does not have

  # BL-1310 reconcile-preserves-discarded-commits-01
  Scenario: Commits the reset discards stay reachable afterwards
    Given local main is ahead by 3 commits
    And the reconcile predicts a content conflict
    When the reconcile runs
    Then local main has been reset to origin/main
    And every commit local main was ahead by is reachable from a rescue ref

  # BL-1310 reconcile-preserves-discarded-commits-02
  Scenario: The operator is told what was discarded and where it went
    Given local main is ahead by 3 commits
    And the reconcile predicts a content conflict
    When the reconcile runs
    Then the reconcile reports the rescue ref
    And the reconcile reports each discarded commit

  # BL-1310 reconcile-preserves-discarded-commits-03
  Scenario: A reconcile that discards nothing leaves no rescue ref behind
    Given local main is not ahead of origin/main
    When the reconcile runs
    Then no rescue ref is created

  # BL-1310 reconcile-preserves-discarded-commits-04
  Scenario: Work that cannot be preserved is not discarded
    Given local main is ahead by 3 commits
    And the reconcile predicts a content conflict
    And the rescue ref cannot be written
    When the reconcile runs
    Then local main is left exactly as it was found
    And the reconcile reports why it did not reconcile

  # BL-1310 reconcile-preserves-discarded-commits-05
  Scenario Outline: Every plan that ends in a reset preserves first
    Given local main is ahead by 3 commits
    And the reconcile plan is <plan>
    When the reconcile runs
    Then every commit local main was ahead by is reachable from a rescue ref

    Examples:
      | plan               |
      | replay-bookkeeping |
      | refuse-rematch     |
