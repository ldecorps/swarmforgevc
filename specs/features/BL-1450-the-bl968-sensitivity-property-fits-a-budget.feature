Feature: BL-1450 The BL-968 guard-sensitivity property fits a budget with every cell and floor kept

  extension/test/bl968MaterializedGuardSensitivity.property.test.js proves
  that a planted load-time-binding module of any class at any chain depth
  turns the BL-761 gate red naming it. It iterates 3 classes x 2 depths and
  draws 4 runs per cell, each run planting a module into a materialized
  pipeline tree and running the guard in a fresh process: 96 real spawns per
  run, 164-193 s alone on this host and 346 s under the lane's pool on
  2026-09-06, past its own 300 s timeout. The commit-time property guard
  re-runs a red file alone under a shared 180 s ceiling (BL-1407), which
  this file cannot fit, so every full run that times it out refuses an
  unrelated commit - BL-676's did. BL-1062 iterates the cells so the reach
  floors hold by construction; this feature keeps that and makes the
  file fit: fewer draws per cell, the same cells, floors re-derived from
  the run count rather than dropped, no assertion weakened.

  # BL-1450 the-file-completes-alone-within-the-budget-01
  Scenario: the property file completes alone within the per-file budget
    Given the property lane's own config
    When bl968MaterializedGuardSensitivity runs alone
    Then it passes
    And it completes within 60 seconds

  # BL-1450 every-cell-and-floor-is-still-exercised-02
  Scenario: every class and depth cell is still exercised and every reach floor still asserted
    When bl968MaterializedGuardSensitivity runs alone
    Then its coverage line reports every required class and every required depth drawn at least once
    And the reach floors asserted after the run equal the counts the cell iteration guarantees by construction

  # BL-1450 a-planted-module-still-turns-the-guard-red-03
  Scenario Outline: a planted load-time-binding module of any class at any depth still turns the guard red naming it
    Given a materialized pipeline tree with a <class> module planted at depth <depth>
    When the BL-761 gate's registry load runs against that tree
    Then the guard is red and names the planted module

    Examples:
      | class             | depth   |
      | git-root-resolve  | direct  |
      | live-repo-read    | via-lib |
      | benign-subprocess | via-lib |
