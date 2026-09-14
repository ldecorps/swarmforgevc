# mutation-stamp: sha256=7ff802fce9cc9f47eb40cedeb589b6587986856d5f1ef6668a322e3732d2998a
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-14T00:42:01.911094805Z","feature_name":"BL-1538 The BL-1028 property runner's fixture carries its subject's bb closure","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1538-the-bl1028-property-runner-fixture-carries-its-bb-closure.feature","background_hash":"d0365ab4fd6962a1785d2a9126b56adf25ff4ecf2725c9adbdf97b89c8288b68","implementation_hash":"unknown","scenarios":[{"index":1,"name":"the closure the check derives is pinned, so an empty derivation cannot pass","scenario_hash":"c7d3a334b7247800634f237ea4f0320540b778c924eae60ffaeda97ae4b602e6","mutation_count":5,"result":{"Total":5,"Killed":5,"Survived":0,"Errors":0},"tested_at":"2026-09-14T00:42:01.911094805Z"}]}
# acceptance-mutation-manifest-end

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
