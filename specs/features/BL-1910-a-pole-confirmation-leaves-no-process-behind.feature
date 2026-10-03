Feature: A pole confirmation leaves no process behind

  npm test runs extension/scripts/recordTestDuration.js. When a file runs at
  or above the per-file refusal line, confirmPoleAlone measures it alone
  with a nested vitest run (BL-1633), retried once if it fails (BL-1721).
  That run is a spawnSync with a timeout of three per-file budgets. When the
  timeout fires, spawnSync signals only the vitest process it started; the
  worker processes vitest forked keep running with no parent waiting on
  them. On the loaded swarm host that is a feedback loop: every orphan adds
  load, more files cross the line, and more confirmations time out. The
  coder's BL-1904 unit run, at load about 44, failed four unrelated files
  that all passed alone a minute later.

  # BL-1910 a-timed-out-confirmation-leaves-no-process-01
  # The fixture shortens the confirmation's timeout so the test outlives it
  # in seconds, never the real three-budget wait.
  Scenario: a confirmation that times out says so and leaves no process behind
    Given a fixture test file that runs longer than the confirmation's timeout
    When confirmPoleAlone confirms it
    Then it returns a failed confirmation that names the timeout
    And no process the confirmation started is still running

  # BL-1910 a-finished-confirmation-leaves-no-process-02
  Scenario: a confirmation that finishes reports the duration and leaves no process behind
    Given a fixture test file that sleeps 200 ms
    When confirmPoleAlone confirms it
    Then it returns a measured duration of at least 200 ms
    And no process the confirmation started is still running
