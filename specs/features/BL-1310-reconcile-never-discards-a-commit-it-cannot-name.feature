Feature: The master-main reconcile never discards local-ahead commits

  BL-1310. Human ruling: never discard local-ahead commits - refuse and
  surface, a human resolves it. Every guard shipped so far (BL-1198, BL-1214,
  BL-1236, BL-1288) narrows WHEN `master-main-rematch-onto-origin!` may reach
  `git reset --hard origin/main`; none of them changes WHAT HAPPENS TO THE
  COMMITS once it does. The human's ruling closes that gap by removing the
  reset's authority over local-ahead commits entirely: when local main carries
  a commit origin/main does not have and a content conflict is predicted, the
  reconcile refuses and reports instead of resetting. Reset onto origin/main
  remains available only when local main is not ahead - nothing local would be
  lost.

  Background:
    Given a master checkout on main
    And origin/main has advanced with commits local main does not have

  # BL-1310 reconcile-refuses-local-ahead-01
  Scenario: A rejected push with local-ahead commits is refused, not reset
    Given local main is ahead by 3 commits
    And the reconcile predicts a content conflict
    When the reconcile runs
    Then local main is left exactly as it was found
    And no reset is attempted

  # BL-1310 reconcile-refuses-local-ahead-02
  Scenario: The operator is told why the reconcile did not reset
    Given local main is ahead by 3 commits
    And the reconcile predicts a content conflict
    When the reconcile runs
    Then the reconcile reports local-ahead refusal
    And the report names BL-1310

  # BL-1310 reconcile-refuses-local-ahead-03
  Scenario: A reconcile with nothing local-ahead may still reset after rejection
    Given local main is not ahead of origin/main
    And the push to origin is rejected
    When the rematch path runs
    Then local main has been reset to origin/main

  # BL-1310 reconcile-refuses-local-ahead-04
  Scenario: An undeterminable ahead-count refuses rather than guesses
    Given local main's ahead-count against origin/main cannot be determined
    When the reconcile runs
    Then local main is left exactly as it was found
    And the reconcile reports why it did not reconcile
