Feature: BL-1977 The hardener gates changed Babashka code on touch

  BL-472 slice 3 of 3. The swarm's own machinery is Babashka under
  swarmforge/scripts, and it has had no mutation or duplication gate: on
  2026-10-04 a property check there passed while checking nothing through
  two QA passes, and QA found it only by planting a mutant by hand. With the
  JVM toolchain (BL-1975) and the vendored tools (BL-1976), the hardener's
  gate runs clj-mutate and dry4clj on the Babashka libraries a change
  touches, judging only the forms it touched, so the existing corpus never
  blocks a ticket all at once. Each mutant runs against the library's own
  test runner with the faster runner BL-1976 measured.

  Background:
    Given a fixture repository whose swarmforge/scripts holds a Babashka library and its test runner

  # BL-1977 a-surviving-mutant-in-a-changed-form-fails-01
  Scenario: a mutant left alive in a form the change touched fails the gate
    Given a change to the library that leaves a mutant alive in a form it touched
    When the Babashka quality gate runs on the change
    Then the gate fails naming the surviving mutant and its line

  # BL-1977 a-clean-change-passes-02
  Scenario: a change whose touched forms kill every mutant and add no duplication passes
    Given a change to the library whose every mutant in the touched forms is killed
    When the Babashka quality gate runs on the change
    Then the gate passes

  # BL-1977 an-untouched-form-is-not-judged-03
  Scenario: a mutant alive only in a form the change did not touch does not fail the gate
    Given a change to the library that leaves a mutant alive only in a form it did not touch
    When the Babashka quality gate runs on the change
    Then the gate passes

  # BL-1977 test-code-is-out-of-scope-04
  Scenario: a change only under swarmforge/scripts/test is not gated
    Given a change that touches only files under swarmforge/scripts/test
    When the Babashka quality gate runs on the change
    Then the gate checks nothing and passes

  # BL-1977 a-library-without-a-runner-is-recorded-05
  Scenario: a changed library with no test runner is recorded as hardening debt
    Given a change to a library that has no test runner
    When the Babashka quality gate runs on the change
    Then the gate passes, naming the library as having no runner
    And a hardening-debt row names that library

  # BL-1977 new-duplication-fails-06
  Scenario: a change that duplicates an existing function fails the gate
    Given a change that adds a copy of a function the library already has
    When the Babashka quality gate runs on the change
    Then the gate fails naming both copies
