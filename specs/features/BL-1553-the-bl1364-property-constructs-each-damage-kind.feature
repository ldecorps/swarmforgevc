Feature: BL-1553 The bl1364 property constructs each damage kind

  extension/test/bl1364TurnProfileSeriesInvariants.property.test.js asserts
  that invariant 2 generated interior damage, a missing transcript and an
  unreadable path at least once each, but the damage kind is only sampled
  from fc.integer 0..2 over 15 draws, so about one run in ten never draws
  one kind and the file is red on main with nothing wrong in the producer
  it exercises. This feature is that the damage kind is iterated by the
  test, the way BL-1533 iterates the delta sign, so the floors are met by
  construction on every run and stay asserted at their values.

  # BL-1553 constructs-each-damage-kind-01
  Scenario: the property file is green on the tree as it stands
    When extension/test/bl1364TurnProfileSeriesInvariants.property.test.js runs alone under the properties config
    Then every test in it passes

  # BL-1553 constructs-each-damage-kind-02
  Scenario: invariant 2 reports reaching every damage-kind floor from the run itself
    When extension/test/bl1364TurnProfileSeriesInvariants.property.test.js runs alone under the properties config
    Then the run prints a reach map for invariant 2
    And that reach map counts interior, missing and unreadablePath at least once each
    And the three counts in that reach map sum to at least 15

  # BL-1553 constructs-each-damage-kind-03
  Scenario Outline: the reach floor for each damage kind is still asserted in the test source
    When the source of extension/test/bl1364TurnProfileSeriesInvariants.property.test.js is read
    Then it still asserts that <kind> was generated at least once

    Examples:
      | kind           |
      | interior       |
      | missing        |
      | unreadablePath |
