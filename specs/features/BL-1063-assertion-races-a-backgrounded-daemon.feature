Feature: BL-1063 an assertion about a backgrounded child waits for that child
  `start_handoff_daemon.sh` backgrounds the daemon and returns immediately. The
  property test reads a marker file that backgrounded child writes, with no wait
  and no poll, so the read races the child. The race is real on an idle host and
  widens under contention - this is the one file in the reported set where
  "flaky under worktree load" is the accurate diagnosis. A fixed sleep is not
  the fix: it trades a race for a slower race.

  # BL-1063 backgrounded-child-wait-01
  Scenario: the assertion waits for the child's marker
    Given a launcher that backgrounds a daemon which writes a marker file
    When the test asserts on that marker
    Then it waits for the marker under a bounded deadline before asserting

  # BL-1063 backgrounded-child-wait-02
  Scenario: a child that never writes fails on the deadline, not on a race
    Given a backgrounded daemon that never writes its marker
    When the test asserts on that marker
    Then the test fails only after the bounded deadline elapses
    And the failure names the marker that never appeared

  # BL-1063 backgrounded-child-wait-03
  Scenario: the wait is bounded and returns early
    When the wait is inspected
    Then it polls under a declared maximum deadline
    And it returns as soon as the marker appears
