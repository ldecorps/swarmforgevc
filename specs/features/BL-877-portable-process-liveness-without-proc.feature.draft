Feature: Process liveness is detected on a host without /proc

  The sandbox sweep asks "is a live process rooted here?" to decide what to
  KEEP; the fixture reaper asks the same question to decide what to KILL. Both
  read that answer from one shared primitive, so both must get a real answer on
  every declared target OS — not an empty one that reads as "nothing is live".

  Background:
    Given the sweeps are pointed at a private fixture root, never the real /tmp
    And every candidate directory in it is older than the staleness threshold

  # BL-877 portable-process-liveness-01
  Scenario Outline: a stale sandbox held by a live process is kept, however it is held
    Given a stale sandbox directory
    And a live process rooted in it by <rooting>
    When the sandbox sweep runs
    Then the sandbox directory still exists

    Examples:
      | rooting                 |
      | its working directory   |
      | an open file descriptor |

  # BL-877 portable-process-liveness-02
  Scenario: a stale sandbox with nothing rooted in it is still reaped
    Given a stale sandbox directory
    And no live process rooted in it
    When the sandbox sweep runs
    Then the sandbox directory is removed

  # BL-877 portable-process-liveness-03
  Scenario: the fixture reaper kills the process rooted in the root it reaps
    Given a stale fixture root
    And a live process rooted in it
    When the fixture reaper sweep runs
    Then the process is no longer running
    And the fixture root is removed

  # BL-877 portable-process-liveness-04
  Scenario Outline: the same rooted process yields the same verdict on either userland
    Given a host running the <userland> userland
    And a stale sandbox directory
    And a live process rooted in it
    When the sandbox sweep runs
    Then the sandbox directory still exists

    Examples:
      | userland |
      | BSD      |
      | GNU      |

  # BL-877 portable-process-liveness-05
  Scenario: a host with no working liveness facility says so instead of reporting nothing live
    Given a host on which no liveness facility can be reached
    And a stale sandbox directory
    And a live process rooted in it
    When the sandbox sweep runs
    Then the sweep records that liveness could not be determined
    And the sandbox directory still exists
