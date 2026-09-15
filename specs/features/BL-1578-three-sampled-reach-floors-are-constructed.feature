# mutation-stamp: sha256=7bb6e22d44ae72e1e39f810c18a0b7f1cd5ad5cf06d389b93f750a6c10785d5a
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-15T17:28:47.174226818Z","feature_name":"BL-1578 Three sampled reach floors are constructed","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1578-three-sampled-reach-floors-are-constructed.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":1,"name":"each constructed loop reports reaching its floor from the run itself","scenario_hash":"aae8978d04601026b9ed2cb7ddaa56af6147a94e0a492458f4fceeb23605cf6b","mutation_count":24,"result":{"Total":24,"Killed":24,"Survived":0,"Errors":0},"tested_at":"2026-09-15T17:28:47.174226818Z"},{"index":0,"name":"each property file is green on the tree as it stands","scenario_hash":"e1c657db2eb01f563c06617e8b883c45ee54e023771968d6021a55bb5438b56d","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-09-15T16:44:15.494304057Z"},{"index":2,"name":"each reach floor is still asserted in its test source","scenario_hash":"a24d9b5e8684a52b3a57c996d5a9ee0cffad6571383e26086e57adfb6768e4fd","mutation_count":10,"result":{"Total":10,"Killed":10,"Survived":0,"Errors":0},"tested_at":"2026-09-15T16:44:15.494304057Z"}]}
# acceptance-mutation-manifest-end

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
