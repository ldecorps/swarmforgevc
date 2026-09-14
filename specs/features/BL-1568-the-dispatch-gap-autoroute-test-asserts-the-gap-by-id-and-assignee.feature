Feature: BL-1568 The dispatch-gap autoroute test asserts the gap by id and assignee

  read-active-items has carried a status key since BL-1301 (2026-09-02) so
  the parked-ticket sweep can read a deliberate park from the same single
  read, and dispatch-gap-items passes the reader's maps through unchanged.
  test_dispatch_gap_autoroute.sh's first case asserts exact map equality
  against the two keys it knew, and has been red on main since. This
  feature is that the case asserts what the auto-route draft consumes - one
  gap, id BL-217, assignee coder - and tolerates the keys it does not.

  # BL-1568 dispatch-gap-by-id-and-assignee-01
  Scenario: the shell test is green on the tree as it stands
    When swarmforge/scripts/test/test_dispatch_gap_autoroute.sh runs
    Then it prints ALL PASS and exits zero

  # BL-1568 dispatch-gap-by-id-and-assignee-02
  Scenario: the fix is the assertion, not the sweep
    When swarmforge/scripts/chase_sweep_lib.bb on the tree as it stands is compared with main
    Then it is unchanged

  # BL-1568 dispatch-gap-by-id-and-assignee-03
  Scenario: the gap case still pins one gap with the right id and assignee
    When the file swarmforge/scripts/test/test_dispatch_gap_autoroute.sh is read
    Then its gap case asserts exactly one gap
    And its gap case asserts the gap id BL-217 and the assignee coder

  # BL-1568 dispatch-gap-by-id-and-assignee-04
  Scenario Outline: the bb runners over the same functions stay green
    When swarmforge/scripts/test/<runner> runs
    Then it exits zero

    Examples:
      | runner                                        |
      | dispatch_gap_test_runner.bb                   |
      | bl1097_router_dispatch_trail_test_runner.bb   |
