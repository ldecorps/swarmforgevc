Feature: A test restores every process.env key it touches

  vitest.config.mjs runs pool: 'forks' with isolate: false — a deliberate BL-445
  perf choice — so process.env mutations persist across every test file sharing
  a worker. A test that unconditionally deletes a key it did not own therefore
  unsets it for the rest of that worker, and unrelated later files fail
  depending on fork scheduling. Observed 2026-07-30: three bare full-suite runs
  produced 5, then 24, then 81 failing tests across varying files.

  The harm is not that the suite fails. It is that the suite's verdict stops
  meaning anything: a run with lucky scheduling reads green, an unlucky one
  reads as a scattershot of regressions in files the ticket never touched.
  Source: QA pass on BL-686, 2026-07-30; extension/test/cursorBridgeAgentSession.test.js.

  Background:
    Given the suite runs with worker isolation off, so process.env persists across files

  # BL-720 env-restore-01
  Scenario Outline: a test restores whatever the key held before it ran
    Given the environment key <prior_state> before the test
    When a test sets that key and finishes
    Then the key <expected_after>

    Examples:
      | prior_state   | expected_after              |
      | holds a value | holds that same value again |
      | is unset      | is unset again              |

  # BL-720 env-restore-02
  Scenario: a later file in the same worker still sees an ambient credential
    Given an ambient credential key is set before the suite starts
    And a file that mutates that key has already run in this worker
    When a later file in the same worker reads the key
    Then it sees the ambient credential unchanged

  # BL-720 env-restore-03
  Scenario: no test file changes the environment it was handed
    When the suite runs
    Then no test file has left any process.env key different from the value it found

  # BL-720 env-restore-04
  Scenario: a file that leaks an environment mutation fails the suite loudly
    Given a test file that mutates a key and does not restore it
    When the suite runs
    Then the suite fails naming that file and the leaked key
