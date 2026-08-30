Feature: A socket fixture is rooted short enough for the control socket to bind

  extension/test/socketFixtureShortRootGuard.test.js scans
  specs/pipeline/steps and fails on any step file that builds or references a
  control socket while rooting its fixture at os.tmpdir(). On macOS that base
  is long, and the resulting socket path overruns swarm_socket_lib.bb's
  100-character guard - so the fixture cannot bind and the step fails there
  while passing on Linux.

  Two step files violate it today, so the guard is a standing red in the unit
  lane. lib/socketFixtureRoot.js's mkSocketFixtureRoot already exists as the
  short-rooted alternative; this is adoption, not new machinery.

  Background:
    Given the socket-fixture scan over specs/pipeline/steps

  # BL-1290 socket-fixture-root-01
  Scenario Outline: A socket fixture rooted at the long base is a violation
    Given a step file that builds a control socket rooted at <base>
    When the guard scans it
    Then the step file is <verdict> a violation

    Examples:
      | base                       | verdict         |
      | the OS temp directory      | reported as     |
      | the short socket-fixture root | not reported as |

  # BL-1290 socket-fixture-root-02
  Scenario: The guard reports zero violations across the step tree
    Given every step file under specs/pipeline/steps
    When the guard scans the tree
    Then it reports no socket-fixture root violations at all

  # BL-1290 socket-fixture-root-03
  # The guard exists because the failure is invisible on Linux; the fix must
  # be verified against the length limit, not against a passing Linux run.
  Scenario: A converted fixture's socket path fits the length limit
    Given a step file converted to the short socket-fixture root
    When its control socket path is measured
    Then the path is within the control socket length limit
