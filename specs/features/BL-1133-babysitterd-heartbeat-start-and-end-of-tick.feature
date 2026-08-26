# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-25T13:47:06.384115610Z","feature_name":"babysitterd heartbeats at start and end of each tick","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1133-babysitterd-heartbeat-start-and-end-of-tick.feature","background_hash":"c29d4c5fabac180914c1642ccc0f356a929e60a4205670d75bd919352dabb36b","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: babysitterd heartbeats at start and end of each tick
  babysitterd writes its freshness heartbeat only after `babysitter_check`
  returns. A long mid-tick gather (pipeline-code-on-main cache miss after a
  tip move) or host suspend during the 300s interval ages the log past the
  600s freshness threshold while the pid is still alive — cron then
  FRESHNESS_VIOLATION restart/escalate-spam. Mirror handoffd's BL-789
  start+end pulse: heartbeat at process start, tick start, and tick end.
  Durable dead loops with no pulse still trip stale-heartbeat. Source:
  human Cursor 2026-08-25 after recurring
  `FRESHNESS_VIOLATION escalate … daemon=babysitterd … stale-heartbeat`.

  Background:
    Given babysitterd loops babysitter_check on a fixed interval

  # BL-1133 babysitterd-heartbeat-01
  Scenario: a cold start pulses before the first check returns
    Given babysitterd is starting against a project root
    When the daemon enters its loop
    Then the babysitterd log contains a heartbeat line before the first check finishes

  # BL-1133 babysitterd-heartbeat-02
  Scenario: each tick pulses at start and end
    Given babysitterd is running
    When one full tick completes
    Then the babysitterd log gained a heartbeat before the check ran
    And the babysitterd log gained a heartbeat after the check returned

  # BL-1133 babysitterd-heartbeat-03
  Scenario: a long mid-tick gather does not age past the freshness threshold alone
    Given a tick whose check runs longer than the base freshness threshold
    And heartbeats are pulsed at tick start and tick end
    When the freshness checker samples the log mid-check
    Then the newest heartbeat age is below the babysitterd threshold

  # BL-1133 babysitterd-heartbeat-04
  Scenario: a wedged loop with no further pulses still trips stale-heartbeat
    Given the last babysitterd heartbeat is older than the freshness threshold
    And no commit-in-flight style mute applies to babysitterd
    When the freshness checker runs
    Then it records a stale-heartbeat violation for babysitterd
