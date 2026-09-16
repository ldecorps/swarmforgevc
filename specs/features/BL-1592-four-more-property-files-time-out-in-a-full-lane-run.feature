Feature: BL-1592 Four more fixture-spawning property files are green in a full lane run

  The coder's first full property-lane run for BL-1588 (2026-09-16, 408
  files, 320 seconds, 1-minute load 8.67 at start, 11 forks) timed out four
  fixture-spawning property files that BL-1588 does not name and that carry
  no register row: bl1375, bl1309 and bl1389 at the lane's raw 20-second
  ceiling with no per-test budget at all, and bl1529 at its own bare
  60000 ms third argument, which no lane-level ceiling can reach. BL-1588
  pins its population by named files, so these four are owned here, not
  folded in. This feature is that every test in the four files receives the
  concurrency-aware budget BL-1588 lands, derived from the base the file
  declares today and never from a bare literal, that bl1529's 60-second
  base scales with the lane's concurrency the way the 20-second base does,
  that the parcel's evidence records each file's full-lane text and remedy
  or the green runs that retire its row, and that the three 20-second files
  stay green alone. bl1529's own green runs are QA's e2e step, not a
  scenario, so the feature fits the per-mutant ceiling (BL-1541).

  # BL-1592 four-more-property-files-green-in-a-full-lane-run-01
  Scenario Outline: each 20-second-class property file is green alone on the tree as it stands
    When <file> runs alone under the properties config
    Then every test in it passes

    Examples:
      | file                                                                          |
      | extension/test/bl1375ApprovedSiblingsCanLandInvariants.property.test.js       |
      | extension/test/bl1309LandDecideEntanglementInvariants.property.test.js        |
      | extension/test/bl1389UnlandedSiblingPathNeverRidesInvariants.property.test.js |

  # BL-1592 four-more-property-files-green-in-a-full-lane-run-02
  Scenario Outline: no test in the four files pins a bare per-test timeout
    When the source of <file> is read
    Then it declares exactly <tests> tests
    And no test in it passes a bare numeric literal as its per-test timeout
    And every test in it receives a per-test budget derived from <base> ms through the property lane's budget helper

    Examples:
      | file                                                                          | tests | base  |
      | extension/test/bl1375ApprovedSiblingsCanLandInvariants.property.test.js       | 3     | 20000 |
      | extension/test/bl1309LandDecideEntanglementInvariants.property.test.js        | 3     | 20000 |
      | extension/test/bl1389UnlandedSiblingPathNeverRidesInvariants.property.test.js | 3     | 20000 |
      | extension/test/bl1529ScriptSenderAuditOutcomesInvariant.property.test.js      | 1     | 60000 |

  # BL-1592 four-more-property-files-green-in-a-full-lane-run-03
  Scenario Outline: the parcel's evidence records the full-lane failure and its remedy for each file
    When the parcel's evidence for <file> is read
    Then it records the failing test name and the timeout message verbatim from a full property-lane run and the change that removed it, or it records at least 5 full lane runs and 20 runs alone all green and the register row retired on that evidence

    Examples:
      | file                                                                          |
      | extension/test/bl1375ApprovedSiblingsCanLandInvariants.property.test.js       |
      | extension/test/bl1309LandDecideEntanglementInvariants.property.test.js        |
      | extension/test/bl1389UnlandedSiblingPathNeverRidesInvariants.property.test.js |
      | extension/test/bl1529ScriptSenderAuditOutcomesInvariant.property.test.js      |

  # BL-1592 four-more-property-files-green-in-a-full-lane-run-04
  Scenario Outline: bl1529's 60-second base scales with the lane's own concurrency like the 20-second base
    Given the property lane is running <forks> worker forks
    And the host's 1-minute load average reads 1.8, inside the quiet band
    When the per-test budget for bl1529's audit-outcomes test is resolved from its 60000 ms base
    Then the effective budget is <outcome>

    Examples:
      | forks | outcome                                             |
      | 1     | exactly 60000 ms                                    |
      | 8     | more than 60000 ms                                  |
      | 8     | three times the 8-fork budget of a 20000 ms base    |
