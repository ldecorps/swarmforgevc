Feature: main-lane test files declare their tests to the runner that actually runs them

  # BL-1220 (epic code-quality-gates). Surfaced by QA on 2026-08-28 while
  # clearing BL-1189 (note 001816, priority 00). 25 files under
  # extension/test/*.test.js import `test` from `node:test` instead of using
  # the binding vitest.config.mjs already provides via `globals: true`. Vitest
  # collects nothing from them and reports "No test suite found in file ...".
  #
  # The consequence is not a red, it is darkness. Nothing in this repository
  # runs `node --test`: `npm test` is `node scripts/recordTestDuration.js`,
  # which spawns Vitest and nothing else, and that script's own comment records
  # why ("BL-124: the suite now runs under Vitest (node --test can no longer
  # run the...)"). So these files' assertions have not executed at all since
  # BL-124, while every role reading the tree counts them as coverage.
  #
  # Sibling of BL-1206, which is the same defect in the property lane. That
  # ticket is separately approved, enumerates its own 13 files, and involves
  # the property standing allowlist; this one does not touch either. Ten of
  # these 25 files also carry BL-1221's missing-deps-stub defect and are
  # expected to fail on THAT once collection is repaired here — the intended
  # intermediate state, not a regression.
  #
  # The guard scenario below is lane-scoped on purpose, so this ticket stays
  # independent of BL-1206's landing order.

  # BL-1220 uncollected-file-now-runs-01
  Scenario: A main-lane file that imported from node:test now contributes collected tests
    Given a main-lane test file that declared its tests by importing "test" from "node:test"
    When the unit lane runs that file
    Then the file reports at least one collected test
    And the file does not report "No test suite found"

  # BL-1220 no-main-lane-file-collects-zero-02
  Scenario: No main-lane file in the repaired set collects zero tests
    When the unit lane runs every file in the repaired set
    Then every one of them reports at least one collected test

  # BL-1220 guard-rejects-reintroduced-import-03
  Scenario: The guard fails when a main-lane file reintroduces the node:test import
    Given a main-lane test file that imports "test" from "node:test"
    When the unit-lane import guard runs
    Then the guard fails and names that file

  # BL-1220 guard-ignores-property-lane-04
  Scenario: The guard leaves the property lane alone
    Given a property-lane test file that imports "test" from "node:test"
    When the unit-lane import guard runs
    Then the guard passes
