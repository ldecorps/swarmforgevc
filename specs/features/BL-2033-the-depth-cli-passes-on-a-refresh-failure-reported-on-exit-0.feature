Feature: BL-2033 The depth CLI passes on a refresh failure the refresh reports on exit 0

  Since BL-1874 the throttle refresh CLI (emit-throttle-recommendation.js)
  exits 0 when its refresh fails and names the failure on stderr. The depth
  CLI's refresh-recommendation! printed the refresh's stderr only on a
  non-zero exit, so a failure reported on exit 0 never reached the log of
  the role that asked for the depth. The depth CLI now passes on whatever
  the refresh wrote to stderr, whatever its exit; a non-zero exit still adds
  exit=<n> as before. Stdout is unchanged: the effective depth alone, because
  every caller reads it as a number.

  Background:
    Given a fixture project whose configured active_backlog_max_depth is 3 and whose throttle refresh CLI writes a failure message to stderr and exits 0

  # BL-2033 depth-cli-refresh-stderr-01
  Scenario Outline: a refresh failure reported on exit 0 is passed on to the depth CLI's stderr
    Given the refresh CLI exits with <exit> and writes <carries> to stderr
    When the depth CLI runs on the fixture root
    Then the depth CLI's stdout is the effective depth and nothing else
    And the depth CLI's stderr carries <carries>

    Examples:
      | exit | carries                        |
      | 0    | refresh failed: blocked telemetry |
      | 1    | refresh failed: blocked telemetry |
