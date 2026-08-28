Feature: Main-lane test files declare their tests to the runner that actually runs them

  The unit lane is Vitest. Twenty-four files under extension/test/ declare their
  tests by importing `test` from `node:test` instead, so Vitest collects nothing
  from them and reports "No test suite found". Their assertions are real and
  they pass under `node --test`, but the lane that gates commits never runs one
  of them.

  This is how the BL-1229 crashes stayed invisible for a day: twenty-two
  assertions were throwing rather than asserting, in files the main lane could
  not see well enough to notice.

  BL-1206 drains the property lane's standing allowlist. This is the main lane,
  which has no allowlist at all — the files simply report as failed suites, and
  the count has been read as ambient noise.

  A file that merely mentions "node:test" is not one of these. The detector
  keys on the import, never on the string appearing as data — one file in the
  set matched a naive grep for exactly that reason and collects perfectly well.

  Background:
    Given the unit lane and the property lane

  # BL-1231 main-lane-node-test-imports-leave-assertions-unrun-01
  Scenario: A repaired main-lane file contributes collected tests
    Given a main-lane test file that declared its tests by importing "test" from "node:test"
    When the unit lane runs that file
    Then the file reports at least one collected test
    And the file does not report "No test suite found"

  # BL-1231 main-lane-node-test-imports-leave-assertions-unrun-02
  Scenario: No file in the repaired set collects zero tests
    When the unit lane runs every file in the repaired set
    Then every one of them reports at least one collected test

  # BL-1231 main-lane-node-test-imports-leave-assertions-unrun-03
  Scenario: The assertions survive the repair
    Given a main-lane test file whose assertions passed under the node:test runner
    When the unit lane runs that file after the repair
    Then it reports the same number of tests it reported under the node:test runner

  # BL-1231 main-lane-node-test-imports-leave-assertions-unrun-04
  Scenario: The guard fails when a main-lane file reintroduces the import
    Given a main-lane test file that imports "test" from "node:test"
    When the unit-lane import guard runs
    Then the guard fails and names that file

  # BL-1231 main-lane-node-test-imports-leave-assertions-unrun-05
  Scenario: A file mentioning node:test as data is not a violation
    Given a main-lane test file that contains "node:test" only inside a string literal
    When the unit-lane import guard runs
    Then the guard passes

  # BL-1231 main-lane-node-test-imports-leave-assertions-unrun-06
  Scenario: The guard leaves the property lane alone
    Given a property-lane test file that imports "test" from "node:test"
    When the unit-lane import guard runs
    Then the guard passes
