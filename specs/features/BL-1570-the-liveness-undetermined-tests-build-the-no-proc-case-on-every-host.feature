Feature: BL-1570 The liveness-undetermined tests build the no-proc case on every host

  BL-877 made the fixture reaper and the sandbox sweep keep everything when
  neither /proc nor lsof can answer, and shipped a SWARMFORGE_PROC_DIR seam
  in proc_fd_scan_lib.bb so a test can construct that case. Its two
  liveness-undetermined shell tests force lsof absent and RELY on /proc
  being absent, which is true only on macOS; on the Linux host the swarm
  runs on, liveness is determined and the orphan is reaped, and both files
  have been red since 2026-08-11. This feature is that each file constructs
  the case through the seam on every supported host.

  # BL-1570 liveness-undetermined-every-host-01
  Scenario Outline: the liveness-undetermined shell test is green on the tree as it stands
    When swarmforge/scripts/test/<file> runs
    Then it prints ALL CHECKS PASSED and exits zero

    Examples:
      | file                                                                   |
      | test_operator_runtime_fixture_reaper_sweep_liveness_undetermined.sh    |
      | test_operator_runtime_sandbox_sweep_liveness_undetermined.sh           |

  # BL-1570 liveness-undetermined-every-host-02
  Scenario Outline: the undetermined tick constructs the no-proc case through the seam
    When the file swarmforge/scripts/test/<file> is read
    Then its undetermined tick sets SWARMFORGE_PROC_DIR to a path that does not exist
    And its undetermined tick sets SWARMFORGE_LSOF_BIN to a path that does not exist

    Examples:
      | file                                                                   |
      | test_operator_runtime_fixture_reaper_sweep_liveness_undetermined.sh    |
      | test_operator_runtime_sandbox_sweep_liveness_undetermined.sh           |

  # BL-1570 liveness-undetermined-every-host-03
  Scenario: the fix is the tests, not the sweeps
    When swarmforge/scripts/proc_fd_scan_lib.bb on the tree as it stands is compared with main
    Then it is unchanged
