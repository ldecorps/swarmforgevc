Feature: BL-1564 The bl1297 property costs one bb process per invariant

  extension/test/bl1297MergeOwnPathsInvariants.property.test.js drives the
  real task_scope_gate_lib.bb, land_step_lib.bb and
  unregistered_test_gate_lib.bb through a bbEval helper that loads the
  libraries fresh on every call, once per fixture case: 98 bb processes
  per run, 18 of them in invariant 3, each loading 2871 lines of library
  on top of building a real repository. The 20 s test budget then holds
  alone (7.6-8.7 s) and is missed inside the full 404-file property lane,
  where QA saw it red from the BL-1555 parcel on 2026-09-14. This feature
  is that the file spends one bb process per invariant and still judges
  every case it draws.

  Background:
    Given a counting bb shim is first on PATH
    When extension/test/bl1297MergeOwnPathsInvariants.property.test.js runs alone under the properties config

  # BL-1564 one-bb-process-per-invariant-01
  Scenario: the property file is green on the tree as it stands
    Then every test in it passes

  # BL-1564 one-bb-process-per-invariant-02
  Scenario: the whole file starts no more bb processes than it has invariants
    Then the shim counted at most 3 bb processes

  # BL-1564 one-bb-process-per-invariant-03
  Scenario Outline: each invariant still judges every case it constructs and draws
    Then the run prints a reach map for invariant <invariant>
    And that reach map counts at least <cases> cases

    Examples:
      | invariant | cases |
      | 1         | 21    |
      | 2         | 18    |
      | 3         | 18    |
