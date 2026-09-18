Feature: BL-1632 The bl1071 stray-hang probe counts only its own fixture's hangs

  QA's BL-1614 pass (parcel d5f41ac50d, the full property lane through
  qa-gather.js, 2026-09-17) failed the first test of
  extension/test/bl1071RecoveryBoundedInTime.property.test.js on the
  assertion "a grandchild survived the kill (plain): 2 stray hangs before,
  0 after". The file is touched by nothing on that branch and is green
  alone in 8.47 seconds. Its probe counts every process on the host whose
  command line carries "sleep 3600", sampled before and after each draw's
  sweep, so a concurrent lane's hangs present at the first sample and gone
  at the second fail the draw, and a peer's hang started mid-draw fails it
  the other way round - the verdict follows what else is alive on the
  host, never the sweep under test. This feature is that the probe reads
  only the hang processes this draw's own fixture started, that a hang
  nobody's fixture started is neither counted nor killed, that two
  fixtures alive at once never see each other, that the file stays green
  alone with all four hang shapes, and that the evidence records the
  full-lane text and the remedy. The full-lane green run and the register
  rows leaving are QA's e2e steps, not scenarios, so the feature fits the
  per-mutant ceiling (BL-1541).

  # BL-1632 bl1071-probe-counts-only-its-own-fixtures-hangs-01
  Scenario: a hang the fixture did not start is neither counted nor killed
    Given a hang process alive on the host that no sweep fixture started
    And a sweep fixture built with the plain hang shape
    When the sweep runs against that fixture with a 1500 ms recovery bound
    Then the sweep reports the recovery unfinished
    And the fixture's probe reports 0 hangs
    And the foreign hang process is still alive

  # BL-1632 bl1071-probe-counts-only-its-own-fixtures-hangs-02
  Scenario: two fixtures alive at once never see each other's hangs
    Given a sweep fixture built with the grandchild hang shape whose swarm stub has been started in a process group of its own
    And a second sweep fixture built with the grandchild hang shape whose swarm stub has not run
    When each fixture's hang probe is read
    Then the first fixture's probe reports 2 hangs
    And the second fixture's probe reports 0 hangs

  # BL-1632 bl1071-probe-counts-only-its-own-fixtures-hangs-03
  Scenario: the file is green alone on the tree as it stands
    When extension/test/bl1071RecoveryBoundedInTime.property.test.js runs alone under the properties config
    Then every test in it passes

  # BL-1632 bl1071-probe-counts-only-its-own-fixtures-hangs-04
  Scenario: the evidence records the full-lane failure and the change that removed it
    When the parcel's evidence for extension/test/bl1071RecoveryBoundedInTime.property.test.js is read
    Then it records the failing assertion message verbatim from a full property-lane run and the change that removed it
