Feature: BL-1480 The promote_and_route_next fixtures carry their subject's real bb closure

  Two standing shell tests build a disposable root for promote_and_route_next.sh
  by hand-copying the .bb files its promotion gates needed on 2026-08-08:
  promotion_gates_cli.bb, promotion_gates_lib.bb, backlog_depth_lib.bb,
  swarm_identity_lib.bb and, in one of them, the three depth CLIs. Since then
  backlog_depth_lib.bb load-files daemon_cycle_guard_lib.bb (BL-966,
  2026-08-20) and promotion_gates_lib.bb load-files acceptance_pointer_gate_lib.bb,
  headroom_cap_raise_lib.bb (2026-08-25) and slice_size_envelope_gate_lib.bb
  (2026-08-27). Neither copy-list was edited, so the fixture's bb dies at load:
  test_promote_and_route_next_priority.sh fails outright, and
  test_promote_and_route_next_no_limit_depth.sh fails for the wrong reason -
  the effective-cap CLI dies, promotion_gates_cli.bb falls back to the default
  cap of 5, and the test sees "active count 5 >= cap 5" instead of the no-limit
  it configured. Both are standing rows in the suite manifest, red on main since
  2026-08-20 with no owner. BL-973 shipped copy_bb_closure and a closure guard
  for exactly this rot, but the guard knows only the fixtures hand-enrolled in
  it, and these two never were (BL-1279's shape, a third time). This feature is
  that both fixtures derive their copy set from the entry points they drive,
  both are enrolled in the closure guard, both tests are green, and a fixture
  whose bb dies at load says so instead of asserting on a default.

  Background:
    Given the two promote_and_route_next fixtures that copy .bb files into a disposable root

  # BL-1480 the-promotion-fixtures-carry-their-subjects-bb-closure-01
  Scenario Outline: each fixture copy-list carries the full load-file closure of the entry points it drives
    Given the fixture copy-list in "<file>"
    When the list is checked against the transitive load-file closure of "<entry>"
    Then no closure file is missing from the list

    Examples:
      | file                                                                | entry                            |
      | swarmforge/scripts/test/test_promote_and_route_next_priority.sh       | promotion_gates_cli.bb           |
      | swarmforge/scripts/test/test_promote_and_route_next_no_limit_depth.sh | promotion_gates_cli.bb           |
      | swarmforge/scripts/test/test_promote_and_route_next_no_limit_depth.sh | effective_backlog_depth_cli.bb   |

  # BL-1480 the-promotion-fixtures-carry-their-subjects-bb-closure-02
  Scenario: the copy set is derived, so a new load-file edge upstream is picked up with no edit
    Given a scratch tree in which "promotion_gates_lib.bb" gains one new load-file edge
    When each promote_and_route_next fixture builds its disposable root
    Then the newly required file is copied into that root without any copy-list being edited

  # BL-1480 the-promotion-fixtures-carry-their-subjects-bb-closure-03
  Scenario Outline: every promote_and_route_next standing test passes
    When the standing suite runs "<file>"
    Then the run exits zero and reports no failed check

    Examples:
      | file                                                                |
      | swarmforge/scripts/test/test_promote_and_route_next_priority.sh       |
      | swarmforge/scripts/test/test_promote_and_route_next_no_limit_depth.sh |

  # BL-1480 the-promotion-fixtures-carry-their-subjects-bb-closure-04
  Scenario: a fixture whose bb dies at load time reports the load failure, not a default cap
    Given a promote_and_route_next fixture missing one file from the entry point's closure
    When the test runs against that fixture
    Then the run fails and names the file that could not be loaded
    And no check is reported as passed

  # BL-1480 the-promotion-fixtures-carry-their-subjects-bb-closure-05
  Scenario: the closure guard's own multi-entry check unions every one of the no-limit fixture's declared entry points
    Given the fixture copy-list in "swarmforge/scripts/test/test_promote_and_route_next_no_limit_depth.sh"
    When the guard's own missingFromList check runs against a closure carrying an edge reachable only through the second entry point
    Then the check covered all four of its declared entry points
    And the closure walk reaches the edge behind the second entry point
