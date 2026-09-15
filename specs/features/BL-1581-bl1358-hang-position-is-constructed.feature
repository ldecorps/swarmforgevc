Feature: BL-1581 bl1358 hang position is constructed

  bl1358MutantTimeCeilingInvariants draws where its one hang sits among
  one or two ordinary mutants for 3 runs and then asserts that the hang
  was followed by another mutant at least once, a floor three draws miss
  about one run in 23 (132 of 3000 seeds). The file goes red with nothing
  wrong in the worker it exercises. This feature is that the three hang
  positions - first, middle, last - are met by construction on every run,
  the way BL-1578 iterates its cells, and that the floor stays asserted
  at its value. The per-position floor below is runsPerCell(3, 3) for the
  file's unchanged draw budget.

  Background:
    Given the property file extension/test/bl1358MutantTimeCeilingInvariants.property.test.js

  # BL-1581 bl1358-hang-position-is-constructed-01
  Scenario: the property file is green on the tree as it stands
    When the property file runs alone under the properties config
    Then every test in it passes

  # BL-1581 bl1358-hang-position-is-constructed-02
  Scenario Outline: the constructed loop reports reaching its floor from the run itself
    When the property file runs alone under the properties config
    Then the run prints a BL-1581 reach map for bl1358
    And that reach map counts at least <floor> <population>

    Examples:
      | floor | population                    |
      | 3     | positions                     |
      | 1     | draws of the rarest position  |

  # BL-1581 bl1358-hang-position-is-constructed-03
  Scenario Outline: the reach floor is still asserted in the test source
    When the source of the property file is read
    Then it still asserts the floor <floor>

    Examples:
      | floor            |
      | hangFollowed > 0 |
      | runs > 0         |
