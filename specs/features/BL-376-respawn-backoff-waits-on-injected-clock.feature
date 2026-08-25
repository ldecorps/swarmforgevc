Feature: Respawn backoff waits on an injected clock, never on the real one

  respawnAgent hardcodes `wait: sleepSync` — a real blocking Atomics.wait — into the
  verified-inject retry loop (extension/src/swarm/tmuxClient.ts:435), so four respawn
  tests each burn ~0.78s of REAL wall clock. The constitution bans real timers in
  tests absolutely. The seam already exists one layer down in verifiedInject;
  respawnAgent simply never exposed it, so no test can reach it.

  The fix must not buy speed by deleting the retries: the bounded, backed-off retry
  is itself a required behavior (engineering: every retry loop must be bounded).

  # BL-376 respawn-backoff-injected-clock-01
  Scenario: A test drives the whole retry loop with no real time passing
    Given a pane that never confirms submission, so the retry loop runs to exhaustion
    When respawnAgent runs with an injected wait
    Then every backoff is served by the injected wait
    And the real blocking sleep is never called

  # BL-376 respawn-backoff-injected-clock-02
  Scenario: Production still waits on the real clock
    When respawnAgent runs with no wait injected
    Then it falls back to the real blocking sleep, unchanged

  # BL-376 respawn-backoff-injected-clock-03
  Scenario: The retry loop stays bounded and backed off
    Given a pane that never confirms submission, so the retry loop runs to exhaustion
    When respawnAgent runs with an injected wait
    Then the injected wait is called once per retry, up to the retry cap and no further
    And each delay it is asked for is no shorter than the one before it

  # BL-376 respawn-backoff-injected-clock-04
  Scenario: No test in the respawn suite waits on the wall clock
    When I inspect every respawn test
    Then none of them lets the real blocking sleep run
