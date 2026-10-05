Feature: BL-2004 A land whose suite manifest names a runner its tree does not hold is stopped

  On 2026-10-04 BL-1929's land (fd4c492d3b, a single-parent tip-pure
  replay) carried BL-1851's row in swarmforge/scripts/test/suite-manifest.tsv
  but not the runner it names, and main went red. The coder had resolved a
  conflict on the manifest and committed the merged result under its own
  ticket, so BL-1830's sibling detection, which subtracts other tickets'
  own tagged commits, saw the row as BL-1929's own work. The suite
  inventory names exactly that row on fd4c492d3b's tree ("in the manifest
  but not in the tree: local_seat_tuning_report_lib_test_runner.bb") and is
  clean on main today. This feature checks the tree a land is about to
  publish, whatever produced it.

  # BL-2004 a-manifest-row-with-no-runner-stops-the-land-01
  Scenario: a land whose tree's suite manifest names a runner the tree does not hold is stopped
    Given a commit to land whose suite manifest names a runner that is not in its tree
    When the land checks the commit's tree before publishing
    Then the land stops with a LAND_STOPPED line naming the missing runner
    And nothing is pushed

  # BL-2004 an-agreeing-tree-is-published-02
  Scenario: a land whose tree and suite manifest agree goes on to publish
    Given a commit to land whose suite manifest and test files agree
    When the land checks the commit's tree before publishing
    Then the check passes and the land goes on to publish
