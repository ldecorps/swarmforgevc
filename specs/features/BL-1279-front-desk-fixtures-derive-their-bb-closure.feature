# Four standing-suite shell tests drive front_desk_supervisor.bb inside a
# disposable fixture root, and each hand-maintains the list of .bb files it
# copies there. The supervisor load-files EIGHT libs; every one of the four
# lists names SIX. Babashka resolves load-file relative to the loading file,
# so the subprocess dies at load time - front_desk_supervisor.bb:98:1, the
# `daemon_log_freshness_pulse_lib.bb` edge - before any scenario reaches the
# behaviour it means to gate.
#
# Measured on main 2026-08-29: all four are RED.
#   test_front_desk_supervisor_bl622_refusal.sh   3 FAIL / 8 checks
#   test_front_desk_supervisor_tick.sh            dies at load (exit 1)
#   test_front_desk_supervisor_liveness.sh        dies at load (exit 1)
#   test_front_desk_supervisor_fleet_creds.sh     dies at load (exit 1)
#
# The two missing edges arrived in commits that RESTORED dropped work:
# `daemon_log_freshness_pulse_lib.bb` in 20999b11c (fix(BL-784)) and
# `self_heal_telemetry_lib.bb` in 8feaa2ad2 (BL-1273). Neither updated the
# four copy-lists, because nothing makes them.
#
# The worse half is what still reports OK. In the refusal test only the three
# LOG-CONTENT checks fail; the other five pass VACUOUSLY, because a process
# that never started also exits non-zero, also claims no pid file, and also
# writes no received-env.json. The refusal wiring those tests exist to gate -
# BL-622's duplicate-poller guard, BL-436's fleet creds, BL-370's liveness
# escalation, BL-303's recovery budget - is effectively untested while three
# assertions carry the whole red.
#
# BL-973 already built the remedy and applied it to FIVE fixtures:
# `copy_bb_closure` (swarmforge/scripts/test/lib/bb_closure_copy.sh) derives
# the copy set from the entry point's transitive load-file closure, and
# `bbFixtureClosureGate.js` keeps each list honest. These four were never
# enrolled - BL-973 derived each list's CONTENTS by construction but left
# WHICH fixtures are guarded hand-enumerated in an Examples table of five.

Feature: The front-desk supervisor fixtures derive their bb closure instead of hand-listing it

  Background:
    Given the front-desk supervisor fixtures that copy .bb files into a disposable root

  # BL-1279 front-desk-fixtures-derive-their-bb-closure-01
  Scenario Outline: each fixture copy-list carries the supervisor's full load-file closure
    Given the fixture copy-list in "<file>"
    When the list is checked against the transitive load-file closure of "front_desk_supervisor.bb"
    Then no closure file is missing from the list

    Examples:
      | file                                                            |
      | swarmforge/scripts/test/test_front_desk_supervisor_bl622_refusal.sh |
      | swarmforge/scripts/test/test_front_desk_supervisor_tick.sh          |
      | swarmforge/scripts/test/test_front_desk_supervisor_liveness.sh      |
      | swarmforge/scripts/test/test_front_desk_supervisor_fleet_creds.sh   |

  # BL-1279 front-desk-fixtures-derive-their-bb-closure-02
  Scenario: the copy set is derived, so a new load-file edge upstream is picked up with no edit
    Given a scratch tree in which "front_desk_supervisor.bb" gains one new load-file edge
    When each front-desk supervisor fixture builds its disposable root
    Then the newly required file is copied into that root without any copy-list being edited

  # BL-1279 front-desk-fixtures-derive-their-bb-closure-03
  Scenario Outline: every front-desk supervisor standing test passes
    When the standing suite runs "<file>"
    Then the run exits zero and reports no failed check

    Examples:
      | file                                                            |
      | swarmforge/scripts/test/test_front_desk_supervisor_bl622_refusal.sh |
      | swarmforge/scripts/test/test_front_desk_supervisor_tick.sh          |
      | swarmforge/scripts/test/test_front_desk_supervisor_liveness.sh      |
      | swarmforge/scripts/test/test_front_desk_supervisor_fleet_creds.sh   |

  # BL-1279 front-desk-fixtures-derive-their-bb-closure-04
  Scenario: a fixture whose subprocess dies at load time reports no passed checks
    Given a front-desk supervisor fixture missing one file from the entry point's closure
    When the test runs against that fixture
    Then the run fails and names the file that could not be loaded
    And no check is reported as passed
