Feature: BL-1533 The bl604 property constructs each delta sign

  extension/test/bl604TrendAnalysisInvariants.property.test.js asserts that
  invariant 1 drew an up delta and a down delta at least SIGN_FLOOR times
  each, but the signs are only sampled from 12 draws of small series sets,
  so roughly one run in seven misses a floor and the file is red on main
  with nothing wrong in the code it exercises. This feature is that the
  sign of a trendable series' final delta is chosen by the generator, the
  way the length bucket already is, so the floors are met by construction
  on every run and stay asserted at their values.

  # BL-1533 constructs-each-delta-sign-01
  Scenario: the property file is green on the tree as it stands
    When extension/test/bl604TrendAnalysisInvariants.property.test.js runs alone under the properties config
    Then every test in it passes

  # BL-1533 constructs-each-delta-sign-02
  Scenario Outline: the signed-series generator yields the sign it was asked for on every draw
    When 200 series are sampled from the signed-series generator for sign <sign>
    Then computeTrend reports direction <sign> for every sampled series
    And every sampled series has between 2 and 8 points

    Examples:
      | sign |
      | up   |
      | down |
      | flat |

  # BL-1533 constructs-each-delta-sign-03
  Scenario: invariant 1 reports reaching both sign floors from the run itself
    When extension/test/bl604TrendAnalysisInvariants.property.test.js runs alone under the properties config
    Then the run prints a reach map for invariant 1
    And that reach map counts up at least 10 times and down at least 10 times
