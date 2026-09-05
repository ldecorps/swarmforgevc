Feature: BL-1409 BL-570's wiring assertion follows the delegation

  BL-570 installed the property-suite drift guard in the shared pre-commit
  hook and pinned that wiring with a step that reads the hook for the guard's
  name in a non-comment line. BL-1252 made the hook a thin wrapper that execs
  run_commit_guards.sh, which is now the file that names the guard. The guard
  has been wired the whole time; the assertion was one level too shallow, and
  it has failed BL-570's Background, and with it all seven scenario runs,
  since 2026-08-30. test_property_suite_drift_guard.sh case 07 asserts the
  same line and copies a hook that now execs a runner its fixture never had.

  This feature is that the installed check follows the delegation: the hook
  invokes the runner in a non-comment line, and the runner's guard set, as
  BL-1398's helper derives it, names check_property_suite_drift.sh.

  # BL-1409 bl570-is-green-against-todays-chain-01
  Scenario: BL-570's feature passes every scenario run against the hook and runner as they stand
    Given the real pre-commit hook and runner
    When the BL-570 feature runs
    Then every scenario run passes

  # BL-1409 the-check-follows-the-delegation-02
  Scenario: a hook that execs a runner naming the guard passes the installed check
    Given a chain seam where the hook execs the runner and the runner names the property guard
    When the installed check runs against the seam
    Then the check passes

  # BL-1409 a-broken-hop-fails-loud-03
  Scenario Outline: a broken hop in the delegation fails the installed check naming it
    Given a chain seam where <broken_hop>
    When the installed check runs against the seam
    Then the check fails naming "<named>"

    Examples:
      | broken_hop                                      | named                         |
      | the hook names the runner only in a comment     | run_commit_guards.sh          |
      | the runner's guard set omits the property guard | check_property_suite_drift.sh |

  # BL-1409 the-drift-guard-shell-suite-is-green-04
  Scenario: the drift-guard shell suite passes with case 07 following the same delegation
    Given the real pre-commit hook and runner
    When the drift-guard shell suite runs
    Then every case passes
