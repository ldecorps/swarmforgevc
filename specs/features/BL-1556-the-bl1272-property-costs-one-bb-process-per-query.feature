Feature: BL-1556 The bl1272 property costs one bb process per query

  extension/test/bl1272LandedSiblingInvariants.property.test.js drives the
  real land_step_lib.bb through
  specs/pipeline/steps/lib/bl1272LandDecisionCli.bb, whose header promises
  that a whole property run costs one bb process. The landed-batch query is
  batched for exactly that, but invariant 1 calls it once per fast-check
  draw: 60 draws, 60 bb processes, each loading the 2118-line library,
  0.19 s each on a quiet host and more under load. The 20 s test budget
  then holds only on a quiet host: alone on main the property took 29.2 s
  and failed, then 19.5 s and passed. This feature is that the test spends
  one bb process per query, and that a fixture git step that fails says so
  instead of surfacing later as an unexplained ref error.

  # BL-1556 one-bb-process-per-query-01
  Scenario: the property file is green on the tree as it stands
    Given a counting bb shim is first on PATH
    When extension/test/bl1272LandedSiblingInvariants.property.test.js runs alone under the properties config
    Then every test in it passes

  # BL-1556 one-bb-process-per-query-02
  Scenario: the whole file starts no more bb processes than it has queries
    Given a counting bb shim is first on PATH
    When extension/test/bl1272LandedSiblingInvariants.property.test.js runs alone under the properties config
    Then the shim counted at most 3 bb processes

  # BL-1556 one-bb-process-per-query-03
  Scenario: invariant 1 still judges every drawn case
    Given a counting bb shim is first on PATH
    When extension/test/bl1272LandedSiblingInvariants.property.test.js runs alone under the properties config
    Then the run prints a reach map for invariant 1
    And that reach map counts at least 60 cases

  # BL-1556 one-bb-process-per-query-04
  Scenario: a fixture git step that fails names itself
    Given a git shim first on PATH that fails every push
    When the bl1272 land decision CLI answers action-batch for one case
    Then it exits non-zero
    And its stderr names the git step that failed
