Feature: BL-1540 Two shell tests dispatch a self-rooting helper through the real scripts dir

  test_shell_fixture_dispatch_isolation.sh (BL-998) is red on main: it names
  test_ceremony_handoff_cli.sh (BL-1360, 2026-09-03) and
  test_bl1097_router_refuses_dispatched_ticket.sh (BL-1415, 2026-09-05), each of
  which binds a helper through $SCRIPT_DIR/../ and executes it - and
  ceremony_handoff.sh and route_backlog_to_coder.sh both cd to their own dirname,
  so where they act is decided by where the file sits, not by the fixture root
  the test passes. Both tests postdate the guard and the guard runs in no
  standing lane, so nothing said so. This feature is that each test reaches its
  subject through a copy inside its own fixture, that the guard is green, and
  that each repaired test still passes.

  Background:
    Given the guard "swarmforge/scripts/test/test_shell_fixture_dispatch_isolation.sh" which names shell tests executing a self-rooting helper through the real scripts dir

  # BL-1540 two-shell-tests-dispatch-a-self-rooting-helper-through-the-real-scripts-dir-01
  Scenario Outline: each repaired test reaches its subject through its own fixture copy
    When the guard's offence derivation is run over "<test>"
    Then it names no offence in "<test>"
    And the path through which "<test>" executes "<helper>" lies under its fixture root

    Examples:
      | test                                                                  | helper                    |
      | swarmforge/scripts/test/test_ceremony_handoff_cli.sh                  | ceremony_handoff.sh       |
      | swarmforge/scripts/test/test_bl1097_router_refuses_dispatched_ticket.sh | route_backlog_to_coder.sh |

  # BL-1540 two-shell-tests-dispatch-a-self-rooting-helper-through-the-real-scripts-dir-02
  Scenario: the guard is green on main
    When the standing suite runs "swarmforge/scripts/test/test_shell_fixture_dispatch_isolation.sh"
    Then the run exits zero and reports no offending shell test

  # BL-1540 two-shell-tests-dispatch-a-self-rooting-helper-through-the-real-scripts-dir-03
  Scenario Outline: each repaired test is itself still green
    When the standing suite runs "<test>"
    Then the run exits zero and reports no failed check

    Examples:
      | test                                                                  |
      | swarmforge/scripts/test/test_ceremony_handoff_cli.sh                  |
      | swarmforge/scripts/test/test_bl1097_router_refuses_dispatched_ticket.sh |
