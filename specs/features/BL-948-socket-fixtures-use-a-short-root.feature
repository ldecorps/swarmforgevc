Feature: Acceptance fixtures that build a control socket use a short root

  macOS resolves os.tmpdir() under /var/folders/<hash>/<hash>/T/, so a
  fixture root created there plus .swarmforge/tmux/<hash>.sock overruns the
  100-char unix-socket guard in swarm_socket_lib.bb. The guard then refuses,
  correctly, before the scenario reaches what it meant to exercise. Three
  separate step files hit this on 2026-08-19 alone and each was patched on
  its own.

  Background:
    Given the shared fixture-root helper for socket-building fixtures

  # BL-948 socket-fixtures-use-a-short-root-01
  Scenario: A fixture root from the helper leaves room for the socket path
    When a fixture root is created through it
    Then the control socket path built under it is within the guard's limit

  # BL-948 socket-fixtures-use-a-short-root-02
  Scenario: The previously failing scenario reaches the behaviour it asserts
    Given a role whose process is still alive
    When the fixture relaunches that role through role_lifecycle.sh unpark
    Then it refuses because the process is still running
    And the refusal does not mention the socket path limit

  # BL-948 socket-fixtures-use-a-short-root-03
  Scenario Outline: The gate flags only socket-building fixtures on the long base
    Given a step file that <fixture>
    When the fixture-root gate runs
    Then it <verdict> that step file

    Examples:
      | fixture                                             | verdict            |
      | builds a control socket under an os.tmpdir() root   | fails naming       |
      | creates a fixture root but builds no control socket | stays silent about |

  # BL-948 socket-fixtures-use-a-short-root-05
  Scenario: A fixture root is removed even when the scenario throws
    When a scenario holding a fixture root throws before its last assertion
    Then that fixture root is removed anyway
