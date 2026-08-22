Feature: Every socket-building acceptance fixture roots short enough for the socket guard

  BL-948 shipped a standing gate and a shared helper so that a step file which
  builds or references a control socket cannot root its fixtures at
  os.tmpdir() - macOS resolves that under /var/folders/<hash>/<hash>/T/, and
  the resulting socket path overruns swarm_socket_lib.bb's 100-char guard, so
  a scenario fails on the refusal instead of the behaviour it asserts.

  BL-982's and BL-983's step files do exactly that. The gate is not broken: it
  names both files and the remedy. It is simply red on main, and both parcels
  landed anyway.

  Background:
    Given the socket-fixture root gate and the shared short-root helper

  # BL-1002 steps-tree-has-no-long-socket-roots-01
  Scenario: The real step tree reports no long-root socket fixtures
    When the gate scans the step-handler tree
    Then it reports no violations

  # BL-1002 socket-path-fits-the-guard-02
  Scenario Outline: A socket path built under a fixture root fits the guard
    Given a fixture root built by <file> for a control socket
    When a control socket path is formed under it
    Then the path is within the socket guard's limit
    Examples:
      | file                     |
      | bl982SecondSeatSteps.js  |
      | bl983StageQueueSteps.js  |

  # BL-1002 the-behaviour-those-scenarios-assert-is-unchanged-03
  Scenario Outline: The scenarios in the changed files still assert their own behaviour
    Given the step file <file> after its fixture root is shortened
    When its scenarios run
    Then they pass for the reason they were written, not on a socket refusal
    Examples:
      | file                     |
      | bl982SecondSeatSteps.js  |
      | bl983StageQueueSteps.js  |
