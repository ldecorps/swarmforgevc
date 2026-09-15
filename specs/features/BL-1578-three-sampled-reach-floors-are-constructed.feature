Feature: BL-1578 Three sampled reach floors are constructed

  Three property files under extension/test assert a reach floor over a
  population they only SAMPLE, so a seed that never draws the value the
  floor names fails the file with nothing wrong in the code it exercises.
  bl1529ScriptSenderAuditOutcomesInvariant draws outcome kind and stage
  uniformly for 20 runs and asserts each kind reached 5, a floor a kind
  misses about one run in 70 (44 of 3000 seeds). meanTicketTimeCost draws
  the corpus regime 50/50 for 12 runs and asserts the large regime reached
  2, missed about one run in 270 (11 of 3000; QA saw 0 of 12).
  bl622TelegramTokenSeparationInvariant constructs a token collision
  between the first two drawn names while checking the last, so the
  subject sees a genuine collision only when exactly two names were drawn
  and the boolean was true, and 30 draws produce none about one run in
  600 (5 of 3000). This feature is that each floor is met by construction
  on every run, the way BL-1555, BL-1553 and BL-1572 iterate their cells,
  and stays asserted at its value. The per-cell floors below are
  runsPerCell(budget, cells) for each file's unchanged draw budget.

  # BL-1578 three-sampled-reach-floors-are-constructed-01
  Scenario Outline: each property file is green on the tree as it stands
    When <file> runs alone under the properties config
    Then every test in it passes

    Examples:
      | file                                                                   |
      | extension/test/bl1529ScriptSenderAuditOutcomesInvariant.property.test.js |
      | extension/test/meanTicketTimeCost.property.test.js                     |
      | extension/test/bl622TelegramTokenSeparationInvariant.property.test.js  |

  # BL-1578 three-sampled-reach-floors-are-constructed-02
  Scenario Outline: each constructed loop reports reaching its floor from the run itself
    When <file> runs alone under the properties config
    Then the run prints a BL-1578 reach map for <test>
    And that reach map counts at least <floor> <population>

    Examples:
      | file                                                                   | test               | floor | population                 |
      | extension/test/bl1529ScriptSenderAuditOutcomesInvariant.property.test.js | bl1529             | 10    | cells                      |
      | extension/test/bl1529ScriptSenderAuditOutcomesInvariant.property.test.js | bl1529             | 2     | draws of the rarest cell   |
      | extension/test/meanTicketTimeCost.property.test.js                     | meanTicketTimeCost | 2     | regimes                    |
      | extension/test/meanTicketTimeCost.property.test.js                     | meanTicketTimeCost | 6     | draws of the rarest regime |
      | extension/test/bl622TelegramTokenSeparationInvariant.property.test.js  | bl622              | 2     | arms                       |
      | extension/test/bl622TelegramTokenSeparationInvariant.property.test.js  | bl622              | 15    | draws of the rarest arm    |

  # BL-1578 three-sampled-reach-floors-are-constructed-03
  Scenario Outline: each reach floor is still asserted in its test source
    When the source of <file> is read
    Then it still asserts the floor <floor>

    Examples:
      | file                                                                   | floor                            |
      | extension/test/bl1529ScriptSenderAuditOutcomesInvariant.property.test.js | reached.queued >= STAGES.length  |
      | extension/test/bl1529ScriptSenderAuditOutcomesInvariant.property.test.js | reached.failed >= STAGES.length  |
      | extension/test/meanTicketTimeCost.property.test.js                     | casesReachingLargeCorpus >= 2    |
      | extension/test/bl622TelegramTokenSeparationInvariant.property.test.js  | seenConflict.true > 0            |
      | extension/test/bl622TelegramTokenSeparationInvariant.property.test.js  | seenConflict.false > 0           |
