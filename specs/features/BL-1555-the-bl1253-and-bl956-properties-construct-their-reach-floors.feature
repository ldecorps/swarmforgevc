Feature: BL-1555 The bl1253 and bl956 properties construct their reach floors

  Two property files under extension/test assert a reach floor over a
  population they only SAMPLE, so a seed that never draws the value the
  floor names fails the file with nothing wrong in the code it exercises.
  bl1253TokenOwnershipInvariants' flapping arbitrary draws 4..6 states from
  fresh, stale, absent and malformed and asserts the sequence produced at
  least one handover, but about one seed in twenty draws every state fresh
  and no handover can happen (QA seed -1747880424, counterexample six
  fresh). bl956PipelineBoardCaptionCapInvariants draws activeCount 1..15
  and asserts at least 20 of 150 boards overflowed the 12-row grid, a
  floor a uniform draw misses about one run in 370. This feature is that
  each floor is met by construction on every run, the way BL-1553 iterates
  the damage kind and BL-1533 the delta sign, and stays asserted at its
  value.

  # BL-1555 constructs-their-reach-floors-01
  Scenario: the bl1253 property file is green on the tree as it stands
    When extension/test/bl1253TokenOwnershipInvariants.property.test.js runs alone under the properties config
    Then every test in it passes

  # BL-1555 constructs-their-reach-floors-02
  Scenario: every flapping sequence hands the token over at least once
    When extension/test/bl1253TokenOwnershipInvariants.property.test.js runs alone under the properties config
    Then the run prints a reach map for the flapping test
    And that reach map counts at least 24 sequences
    And every sequence in that reach map produced at least one handover

  # BL-1555 constructs-their-reach-floors-03
  Scenario: the bl956 property file is green on the tree as it stands
    When extension/test/bl956PipelineBoardCaptionCapInvariants.property.test.js runs alone under the properties config
    Then every test in it passes

  # BL-1555 constructs-their-reach-floors-04
  Scenario: invariant 3 overflows the grid on more boards than a uniform draw could
    When extension/test/bl956PipelineBoardCaptionCapInvariants.property.test.js runs alone under the properties config
    Then the run prints a reach map for invariant 3
    And that reach map counts at least 50 grid overflow boards
    And that reach map counts at least 20 parked overflow boards and at least 20 epic overflow boards

  # BL-1555 constructs-their-reach-floors-05
  Scenario Outline: each reach floor is still asserted in its test source
    When the source of <file> is read
    Then it still asserts the floor <floor>

    Examples:
      | file                                                                  | floor                    |
      | extension/test/bl1253TokenOwnershipInvariants.property.test.js        | handovers >= 1           |
      | extension/test/bl956PipelineBoardCaptionCapInvariants.property.test.js | gridOverflowSeen >= 20   |
      | extension/test/bl956PipelineBoardCaptionCapInvariants.property.test.js | parkedOverflowSeen >= 20 |
      | extension/test/bl956PipelineBoardCaptionCapInvariants.property.test.js | epicsOverflowSeen >= 20  |
