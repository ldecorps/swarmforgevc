Feature: BL-1589 bl1030 draw kind is constructed

  bl1030StopFlagTokenBoundary draws the kind of each of its 60 admissible
  commands uniformly - real flag, unquoted look-alike, quoted look-alike -
  and then asserts that at least 12 were real flags, a floor a seed misses
  about one run in 130 (Binomial(60, 1/3) below 12: 0.77%). The file goes
  red with nothing wrong in the guard it exercises. This feature is that
  the three kinds are met by construction on every run, the idiom the
  file's other two sweeps already use, and that the floors stay asserted
  at their values. The per-kind floor below is runsPerCell(60, 3) for the
  file's unchanged draw budget.

  Background:
    Given the property file extension/test/bl1030StopFlagTokenBoundary.property.test.js

  # BL-1589 bl1030-draw-kind-is-constructed-01
  Scenario: the property file is green on the tree as it stands
    When the property file runs alone under the properties config
    Then every test in it passes

  # BL-1589 bl1030-draw-kind-is-constructed-02
  Scenario Outline: the constructed loop reports reaching its floor from the run itself
    When the property file runs alone under the properties config
    Then the run prints a BL-1589 reach map for bl1030
    And that reach map counts at least <floor> <population>

    Examples:
      | floor | population               |
      | 3     | kinds                    |
      | 20    | draws of the rarest kind |

  # BL-1589 bl1030-draw-kind-is-constructed-03
  Scenario Outline: the reach floor is still asserted in the test source
    When the source of the property file is read
    Then it still asserts the floor <floor>

    Examples:
      | floor               |
      | refusedCount >= 12  |
      | lookalikeCount >= 12 |
      | hits >= 5           |
