Feature: BL-1572 The bl1429 fold property constructs its combination floor

  bl1429StandingRedThrottleFoldInvariants' invariant 1 draws a rework
  category and a standing-red category uniformly for 60 runs and then
  asserts that all 12 combinations were reached, a floor sixty uniform
  draws over twelve cells miss about one run in fifteen (exact 6.4%,
  measured 6.8% over 3000 seeds, QA alone on 2026-09-14 missing
  severe:count). This feature is that the floor is met by construction on
  every run, the way BL-1555 splits bl956's overflow cell and BL-1553
  iterates the damage kind, and stays asserted at its value. The
  per-combination floor of 5 below is runsPerCell(60, 12): the constructed
  loop yields it on every run, while a uniform draw of 60 landed every
  cell at 5 or more in 0 of 3000 seeds, so only a constructed cell reaches it.

  # BL-1572 constructs-its-combination-floor-01
  Scenario: the property file is green on the tree as it stands
    When the bl1429 fold property file runs alone under the properties config
    Then every test in the fold property file passes

  # BL-1572 constructs-its-combination-floor-02
  Scenario Outline: the constructed loop reports reaching its floor from the run itself
    When the bl1429 fold property file runs alone under the properties config
    Then the run prints a reach map for invariant 1 of the fold property
    And that fold reach map counts at least <floor> <population>

    Examples:
      | floor | population                    |
      | 12    | combinations                  |
      | 5     | draws of the rarest combination |

  # BL-1572 constructs-its-combination-floor-03
  Scenario Outline: each reach floor is still asserted in the fold property source
    When the source of the bl1429 fold property file is read
    Then it still asserts the fold floor <floor>

    Examples:
      | floor                              |
      | seen.size equals all 12 combinations |
      | every combination drawn at least 5 |
