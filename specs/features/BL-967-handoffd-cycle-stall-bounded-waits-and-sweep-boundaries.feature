Feature: BL-967 handoffd cycle stall - bounded waits and self-localizing sweep boundaries

  handoffd's poll cycle can block silently in an unbounded subprocess or
  file wait mid-sweep, exceeding the 300s freshness threshold with no
  end-of-cycle heartbeat, so the watchdog kills and restarts it every ~6
  minutes. Every in-cycle wait must be bounded well under the threshold
  and survived loudly, and heavy cycles must log each sweep's boundary so
  any future stall names its sweep from the log alone.

  Background:
    Given a fixture daemon cycle wired through the test seams with a freshness threshold budget

  # BL-967 cycle-stall-bounded-01
  Scenario: a hung subprocess costs one bounded wait, never the heartbeat
    Given one sweep's injected subprocess hangs past the configured wait bound
    When the daemon runs a heavy cycle
    Then the cycle logs a timeout naming that sweep and call
    And the cycle completes with its end-of-cycle heartbeat inside the threshold budget

  # BL-967 cycle-stall-bounded-02
  Scenario: a heavy cycle logs every sweep's boundary even when idle
    Given no sweep has any action to take
    When the daemon runs a heavy cycle
    Then the log carries one boundary line per sweep in the heavy bundle, each with a duration

  # BL-967 cycle-stall-bounded-03
  Scenario: idle fast ticks add no boundary lines
    Given no sweep has any action to take
    When the daemon runs a fast poll tick that is not a heavy cycle
    Then the log gains no sweep boundary lines from that tick

  # BL-967 cycle-stall-bounded-04
  Scenario: a slow-but-healthy heavy cycle completes without timeouts or kills
    Given every sweep completes normally but the cycle's total duration approaches the threshold budget
    When the daemon runs a heavy cycle
    Then the cycle completes with no timeout logged
    And the end-of-cycle heartbeat lands
