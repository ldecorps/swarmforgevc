Feature: A test budget is justified, not merely present

  BL-969 gave one heavy test a measured budget and left a standing guard
  requiring every real-repo test in that file to carry an explicit timeout.
  The guard checks that a number is there. It does not check that the number
  is big enough.

  So two structurally identical siblings still carry an older budget that has
  since been measured failing in the field, and the guard stays green while
  they flake. A budget that nobody can trace to a measurement is a guess with
  a passing test in front of it.

  Background:
    Given the burndown CLI test file and its recorded load measurements

  # BL-999 budget-covers-the-worst-measurement-01
  Scenario: Every heavy test's budget clears its own worst recorded run
    When the budget guard runs
    Then each real-repo test's budget is at least its worst recorded run times the standard margin

  # BL-999 identical-paths-carry-identical-budgets-02
  Scenario: Tests on the same path do not differ in budget
    Given three tests that all derive from the real repo and render
    When the budget guard runs
    Then their budgets are equal

  # BL-999 a-default-is-a-decision-03
  Scenario: A test left on the suite default records why that is safe
    Given a test that carries no explicit budget
    When the budget guard runs
    Then that test's recorded margin against the suite default is present

  # BL-999 guard-catches-a-present-but-too-small-budget-04
  Scenario: A budget that is present but below its measured basis fails the guard
    Given a heavy test whose budget is below its worst recorded run
    When the budget guard runs
    Then the guard fails
    And the failure names that test, its budget and the measurement it fails to cover
