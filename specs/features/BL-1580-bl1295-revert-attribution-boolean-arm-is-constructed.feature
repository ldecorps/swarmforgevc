Feature: BL-1580 bl1295 revert attribution boolean arm is constructed

  bl1295RevertAttributionInvariants invariant 2 draws its foreign-commit
  boolean uniformly for 6 runs and then asserts that BOTH arms were seen,
  a floor six uniform coin flips miss about one run in 32 (94 of 3000
  seeds). The file goes red with nothing wrong in the gate it exercises.
  This feature is that both arms are met by construction on every run,
  the way BL-1578 iterates its cells, and that the floor stays asserted
  at its value. The per-arm floor below is runsPerCell(6, 2) for the
  file's unchanged draw budget.

  Background:
    Given the property file extension/test/bl1295RevertAttributionInvariants.property.test.js

  # BL-1580 bl1295-revert-attribution-boolean-arm-is-constructed-01
  Scenario: the property file is green on the tree as it stands
    When the property file runs alone under the properties config
    Then every test in it passes

  # BL-1580 bl1295-revert-attribution-boolean-arm-is-constructed-02
  Scenario Outline: the constructed loop reports reaching its floor from the run itself
    When the property file runs alone under the properties config
    Then the run prints a BL-1580 reach map for bl1295
    And that reach map counts at least <floor> <population>

    Examples:
      | floor | population              |
      | 2     | arms                    |
      | 3     | draws of the rarest arm |

  # BL-1580 bl1295-revert-attribution-boolean-arm-is-constructed-03
  Scenario Outline: the reach floor is still asserted in the test source
    When the source of the property file is read
    Then it still asserts the floor <floor>

    Examples:
      | floor                      |
      | seen.clean > 0             |
      | seen.genuinelyForeign > 0  |
