Feature: no subprocess the handoff daemon spawns can hang its cycle past the wait bound

  # BL-1021. handoffd's dispatch-gap-sweep auto-routes by shelling out to
  # swarm_handoff.bb through the bounded sh! chokepoint. That child still
  # uses clojure.java.shell/sh - the exact API handoffd.bb's own header bans
  # as deadlock-prone (BL-061) - and clojure.java.shell has no timeout at
  # all. When a process the child spawns outlives it while holding the
  # inherited stdout/stderr write ends, the stream-pump threads block in
  # read() forever because the pipe never sees EOF. Observed live
  # 2026-08-21: STAT=U, two pump threads in read(), one thread in wait4 on
  # an already-exited child, and NO on-timeout! line - so the 60s bound did
  # not fire either. Restarting does not help: the trigger is still present,
  # and it re-stalls within minutes.

  Background:
    Given the handoff daemon runs its sweep cycle under the bounded subprocess chokepoint

  # BL-1021 bound-fires-when-grandchild-holds-pipe-01
  Scenario: a spawned process whose grandchild holds the pipe open still returns within the wait bound
    Given a subprocess that exits immediately but leaves a grandchild holding its stdout and stderr
    When the daemon runs that subprocess through the chokepoint
    Then the call returns within the configured wait bound
    And the call reports a bounded-wait timeout rather than hanging

  # BL-1021 timeout-is-observable-02
  Scenario: a bounded-wait timeout is announced, never silent
    Given a subprocess that will exceed the configured wait bound
    When the daemon runs that subprocess through the chokepoint
    Then a timeout event naming the sweep and the command is emitted
    And the sweep that owns the call still emits its sweep boundary

  # BL-1021 cycle-survives-a-hung-child-03
  Scenario: the cycle continues to the next sweep after a subprocess hangs
    Given the dispatch-gap sweep spawns a subprocess that never closes its streams
    When the daemon completes that cycle
    Then the sweeps scheduled after the dispatch-gap sweep still run
    And the next cycle starts

  # BL-1021 spawned-scripts-carry-no-unbounded-shell-04
  Scenario: the script the dispatch-gap sweep spawns uses no unbounded subprocess API
    Given swarm_handoff.bb is reachable from the handoff daemon only by a process spawn
    When its source is inspected
    Then it contains no unbounded clojure.java.shell subprocess call
