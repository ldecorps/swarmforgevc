Feature: BL-1606 Two more fixture-spawning property files fit a full lane and no lane budget resolves below its base

  QA's checklist gather on the BL-1598 parcel (2026-09-16, commit
  771b9cdd6d, the unit lane then the property lane in sequence) timed out
  two property files that no open ticket names and that carry no register
  row: bl1304DryRunSpawnsNothing at the lane's raw 20-second ceiling with
  no per-test budget at all (its three tests each spawn the expedite CLI
  under Babashka twelve to fifteen times), and
  bl968MaterializedGuardSensitivity at its own bare 240000 ms third
  argument, which no lane-level ceiling reaches. Both are green alone. The
  second file exposes a gap in the budget helper itself: the shared
  ceiling of 120000 ms sits below that base, so routing the base through
  the helper today would resolve 120000 ms under a busy lane, half the
  budget the file declares, and BL-1596's sweep would carry the same cut
  to every 180000 and 240000 ms site. This feature is that every test in
  the two files derives its budget from the base the file declares today
  through the property lane's budget helper, that the helper never
  resolves below a base at any fork count and lets every base grow with
  the lane's concurrency while a 20000 ms base keeps exactly the budget it
  resolves today, that bl1304 is green alone, and that the evidence
  records each file's full-lane text and remedy. bl968's own green runs
  are QA's e2e step, not a scenario, so the feature fits the per-mutant
  ceiling (BL-1541).

  # BL-1606 two-more-property-files-fit-a-full-lane-01
  Scenario Outline: no test in the two files pins a bare per-test timeout
    When the source of <file> is read
    Then it declares exactly <tests> tests
    And no test in it passes a bare numeric literal as its per-test timeout
    And every test in it receives a per-test budget derived from <base> ms through the property lane's budget helper

    Examples:
      | file                                                              | tests | base   |
      | extension/test/bl1304DryRunSpawnsNothing.property.test.js         | 3     | 20000  |
      | extension/test/bl968MaterializedGuardSensitivity.property.test.js | 1     | 240000 |

  # BL-1606 two-more-property-files-fit-a-full-lane-02
  Scenario Outline: a per-test budget never resolves below its base and every base grows with the lane's concurrency
    Given the property lane is running <forks> worker forks
    And the host's 1-minute load average reads 1.8, inside the quiet band
    When the per-test budget for a fixture-spawning property test is resolved from a <base> ms base
    Then the effective budget is <outcome>

    Examples:
      | base   | forks | outcome             |
      | 240000 | 1     | exactly 240000 ms   |
      | 240000 | 8     | more than 240000 ms |
      | 240000 | 40    | at least 240000 ms  |
      | 20000  | 8     | exactly 40000 ms    |
      | 60000  | 8     | exactly 120000 ms   |

  # BL-1606 two-more-property-files-fit-a-full-lane-03
  Scenario: bl1304 is green alone on the tree as it stands
    When extension/test/bl1304DryRunSpawnsNothing.property.test.js runs alone under the properties config
    Then every test in it passes

  # BL-1606 two-more-property-files-fit-a-full-lane-04
  Scenario Outline: the parcel's evidence records the full-lane failure and its remedy for each file
    When the parcel's evidence for <file> is read
    Then it records the failing test name and the timeout message verbatim from a full property-lane run and the change that removed it

    Examples:
      | file                                                              |
      | extension/test/bl1304DryRunSpawnsNothing.property.test.js         |
      | extension/test/bl968MaterializedGuardSensitivity.property.test.js |
