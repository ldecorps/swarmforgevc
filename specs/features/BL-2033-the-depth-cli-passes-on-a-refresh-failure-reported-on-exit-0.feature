Feature: BL-2033 The effective depth CLI passes on a throttle refresh failure the refresh reports on exit 0

  Since BL-1874 the throttle CLI exits 0 when its refresh fails and names
  the failure on stderr. effective_backlog_depth_cli.bb printed the
  refresh's stderr only on a non-zero exit, so the failure never reached
  the log of the role that asked for the depth. The depth CLI now passes
  on whatever the refresh wrote to stderr, whatever its exit, and still
  prints the effective depth alone on stdout.

  # BL-2033 depth-cli-refresh-stderr-01
  Scenario Outline: the depth CLI's stderr carries what the refresh reported
    Given a project whose configured depth is 3 and whose throttle refresh exits <exit> writing "<message>" to stderr
    When the effective depth CLI runs
    Then it prints 3 on stdout and nothing else
    And its stderr <carries>

    Examples:
      | exit | message                            | carries                              |
      | 0    | refresh failed: telemetry blocked  | names that message                   |
      | 1    | refresh crashed                    | names that message and exit=1        |
      | 0    |                                    | is empty                             |
