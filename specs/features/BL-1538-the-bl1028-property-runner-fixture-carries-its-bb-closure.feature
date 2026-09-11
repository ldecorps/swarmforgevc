Feature: BL-1538 The BL-1028 property runner's fixture carries its subject's bb closure

  bl1028_promotion_refusal_property_runner.bb builds a disposable root for
  promote_and_route_next.sh by hand-listing five .bb files. Since that list was
  written, promotion_gates_lib.bb gained three load-file edges -
  acceptance_pointer_gate_lib.bb (BL-626, 2026-08-25), headroom_cap_raise_lib.bb
  (BL-1128, 2026-08-25) and slice_size_envelope_gate_lib.bb (BL-634, 2026-08-27) -
  so the control promotion dies at load, P0 fails, and every refusal property
  passes vacuously over a promotion that never ran. BL-1496 owns the identical
  rot in the sibling shell fixture; this runner is bb-authored, and the closure
  guard has no kind that can read what a bb fixture copies. This feature is that
  the runner derives its copy set from the entry point it drives, that the guard
  can read a bb-authored fixture behaviourally and watches this one, and that the
  runner is green with its control reached.

  Background:
    Given the fixture "swarmforge/scripts/test/bl1028_promotion_refusal_property_runner.bb" which copies .bb files into a disposable root

  # BL-1538 bl1028-property-runner-fixture-carries-its-bb-closure-01
  Scenario: the fixture copy set carries the full load-file closure of the entry point it drives
    When the copy set the fixture builds is checked against the transitive load-file closure of "promotion_gates_cli.bb"
    Then no closure file is missing from the copy set

  # BL-1538 bl1028-property-runner-fixture-carries-its-bb-closure-02
  Scenario Outline: the closure the check derives is pinned, so an empty derivation cannot pass
    When the transitive load-file closure of "promotion_gates_cli.bb" is derived
    Then the derived closure contains "<required>"

    Examples:
      | required                        |
      | promotion_gates_lib.bb          |
      | backlog_depth_lib.bb            |
      | acceptance_pointer_gate_lib.bb  |
      | headroom_cap_raise_lib.bb       |
      | slice_size_envelope_gate_lib.bb |

  # BL-1538 bl1028-property-runner-fixture-carries-its-bb-closure-03
  Scenario: the copy set is derived, so a new load-file edge upstream is picked up with no edit
    Given a scratch tree in which "promotion_gates_lib.bb" gains one new load-file edge
    When the fixture builds its disposable root
    Then the newly required file is copied into that root without any copy-list being edited

  # BL-1538 bl1028-property-runner-fixture-carries-its-bb-closure-04
  Scenario: the fixture is enrolled in the closure guard through a kind that reads what a bb fixture actually copies
    When the closure guard's watched fixtures are read
    Then the fixture is among them
    And the guard's effective list for the fixture is obtained by running it, not by reading its source

  # BL-1538 bl1028-property-runner-fixture-carries-its-bb-closure-05
  Scenario: the standing runner is green with its control reached
    When the standing suite runs the fixture
    Then the run exits zero and reports ALL PROPERTIES HOLD
    And the coverage line shows control-commit reached at least once
