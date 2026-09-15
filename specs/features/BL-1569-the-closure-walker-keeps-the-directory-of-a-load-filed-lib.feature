Feature: BL-1569 The closure walker keeps the directory of a load-filed lib

  Every fixture copy of a bb script's dependencies is derived from the real
  transitive load-file closure (BL-973), computed by bb_load_closure_lib.bb
  and its JS twin. Both capture only the last string of a load-file form,
  so unregistered_test_gate_lib.bb's "test" "suite_inventory_lib.bb" is
  reported as a bare name that does not exist beside it, and copy_bb_closure
  skips it without a word. The sandbox copy of swarm_handoff.bb then cannot
  load, and test_operator_runtime_hotfix_certification_sweep.sh has been red
  on main since 2026-08-31. This feature is that both walkers report the
  directory-qualified path, a copy places it there or fails loud, and the
  two twins still agree.

  # BL-1569 closure-keeps-directory-01
  Scenario Outline: both walkers report the multi-segment load-file with its directory
    When the <walker> computes the load-file closure of swarm_handoff.bb under swarmforge/scripts
    Then the closure names unregistered_test_gate_lib.bb
    And the closure names test/suite_inventory_lib.bb
    And the closure names no bare suite_inventory_lib.bb

    Examples:
      | walker                                     |
      | bb CLI bb_load_closure_cli.bb              |
      | JS twin operatorRuntimeBbClosure.js        |

  # BL-1569 closure-keeps-directory-02
  Scenario: a single-segment load-file is still reported as a bare name
    When the bb CLI bb_load_closure_cli.bb computes the load-file closure of swarm_handoff.bb under swarmforge/scripts
    Then the closure names handoff_lib.bb
    And no entry other than test/suite_inventory_lib.bb contains a slash

  # BL-1569 closure-keeps-directory-03
  Scenario: a copy of the closure places each member at its relative path
    When copy_bb_closure copies the closure of swarm_handoff.bb from swarmforge/scripts into an empty directory
    Then the directory holds test/suite_inventory_lib.bb
    And loading the copied unregistered_test_gate_lib.bb in bb succeeds

  # BL-1569 closure-keeps-directory-04
  Scenario: a copy whose closure names a missing file fails loud
    Given a scratch scripts directory whose a.bb load-files "missing" "b.bb" and no such file exists
    And a.bb also load-files a second, present file that sorts after the missing one
    When copy_bb_closure, run with no "set -e" in its caller, copies the closure of a.bb from that directory into an empty directory
    Then it exits non-zero
    And its error names missing/b.bb

  # BL-1569 closure-keeps-directory-05
  Scenario: the twins still agree and the red fixture is green
    When swarmforge/scripts/test/bb_load_closure_agreement_test_runner.bb runs
    Then it exits zero
    When swarmforge/scripts/test/test_operator_runtime_hotfix_certification_sweep.sh runs
    Then it prints ALL CHECKS PASSED and exits zero

  # BL-1569 closure-keeps-directory-06
  Scenario: the census of multi-segment load-file forms is the one the ticket counted
    When every load-file form under swarmforge/scripts whose fs/path carries more than one string after the parent is listed
    Then the list names swarmforge/scripts/unregistered_test_gate_lib.bb
    And the list has one entry
