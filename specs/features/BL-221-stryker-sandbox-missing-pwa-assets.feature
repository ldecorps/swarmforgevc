Feature: Stryker mutation runs resolve runtime-loaded pwa/ assets

  Background:
    Given the repository has a sibling pwa/ directory at the repo root
    And the Stryker config lives in extension/ and mutates out/**/*.js

  # BL-221 stryker-pwa-sandbox-01
  Scenario: a test that loads a pwa asset succeeds inside the Stryker sandbox
    Given a unit test that reads pwa/index.html at run time
    When the hardener runs the Stryker mutation dry run
    Then the dry run does not fail with ENOENT on any pwa/ path
    And the test passes inside the sandbox as it does in a normal run

  # BL-221 stryker-pwa-sandbox-02
  Scenario: the mutation gate reaches mutant evaluation instead of aborting
    Given a ticket whose changed files are scoped to out/**/*.js
    When the hardener runs the no-surviving-mutants gate
    Then the run reaches mutant evaluation rather than aborting in the dry run
