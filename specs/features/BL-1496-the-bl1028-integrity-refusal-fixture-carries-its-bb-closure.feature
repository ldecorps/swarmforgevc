Feature: BL-1496 The BL-1028 integrity-refusal fixture carries its subject's bb closure

  test_bl1028_promotion_obeys_integrity_refusal.sh builds a disposable root for
  promote_and_route_next.sh by hand-listing five .bb files. Since that list was
  written, promotion_gates_lib.bb gained three load-file edges -
  acceptance_pointer_gate_lib.bb (BL-626, 2026-08-25), headroom_cap_raise_lib.bb
  (BL-1128, 2026-08-25) and slice_size_envelope_gate_lib.bb (BL-634, 2026-08-27) -
  and the list was never edited, so the fixture's bb dies at load with
  FileNotFoundException and the run reports one failed check for a reason that has
  nothing to do with what it tests. It is the third fixture of this surface to rot
  the same way and the only one with no owner: BL-1480 owns the other two. BL-973
  shipped copy_bb_closure and a closure guard for exactly this rot, but which
  fixtures the guard watches is hand-enumerated and this one was never enrolled -
  BL-1279's shape, a fourth time. This feature is that the fixture derives its copy
  set from the entry points it drives, is enrolled in the closure guard, and is
  green; and that the derivation is pinned to a census, so a check that finds
  nothing fails instead of passing.

  Background:
    Given the fixture "swarmforge/scripts/test/test_bl1028_promotion_obeys_integrity_refusal.sh" which copies .bb files into a disposable root

  # BL-1496 bl1028-integrity-refusal-fixture-carries-its-bb-closure-01
  Scenario: the fixture copy set carries the full load-file closure of the entry point it drives
    When the copy set the fixture builds is checked against the transitive load-file closure of "promotion_gates_cli.bb"
    Then no closure file is missing from the copy set

  # BL-1496 bl1028-integrity-refusal-fixture-carries-its-bb-closure-02
  Scenario Outline: the closure the check derives is pinned, so an empty derivation cannot pass
    When the transitive load-file closure of "promotion_gates_cli.bb" is derived
    Then the derived closure contains "<required>"

    Examples:
      | required                       |
      | promotion_gates_lib.bb         |
      | backlog_depth_lib.bb           |
      | acceptance_pointer_gate_lib.bb |
      | headroom_cap_raise_lib.bb      |
      | slice_size_envelope_gate_lib.bb|

  # BL-1496 bl1028-integrity-refusal-fixture-carries-its-bb-closure-03
  Scenario: the copy set is derived, so a new load-file edge upstream is picked up with no edit
    Given a scratch tree in which "promotion_gates_lib.bb" gains one new load-file edge
    When the fixture builds its disposable root
    Then the newly required file is copied into that root without any copy-list being edited

  # BL-1496 bl1028-integrity-refusal-fixture-carries-its-bb-closure-04
  Scenario: the fixture is enrolled in the closure guard so its list cannot rot again
    When the closure guard's watched fixtures are read
    Then the fixture is among them

  # BL-1496 bl1028-integrity-refusal-fixture-carries-its-bb-closure-05
  Scenario: the standing test is green
    When the standing suite runs the fixture
    Then the run exits zero and reports no failed check
