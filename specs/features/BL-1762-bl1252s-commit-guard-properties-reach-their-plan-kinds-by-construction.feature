# mutation-stamp: sha256=36777a0775d326cc16889f75d6cec72ca53cf5663e7675ce8cd1a7134da11015
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-25T21:41:13.163181351Z","feature_name":"BL-1762 bl1252's commit-guard properties reach their plan kinds by construction","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1762-bl1252s-commit-guard-properties-reach-their-plan-kinds-by-construction.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"each bl1252 property file reaches its plan kinds by construction through the shared helpers","scenario_hash":"469d9234d9f4a257ab0fad6d31d25de183390b4dc11ea73cdb375266f00f9e5f","mutation_count":5,"result":{"Total":5,"Killed":5,"Survived":0,"Errors":0},"tested_at":"2026-09-25T21:41:13.163181351Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1762 bl1252's commit-guard properties reach their plan kinds by construction

  The five bl1252 commit-guard property files draw PLAN() 60 times from
  extension/test/helpers/bl1252CommitGuardFixture.js, a weighted oneof in
  which the clean and suiteOnly plans are 1 in 10 each. Afterwards they
  call the fixture's own assertReach(seen, kinds). A kind can go undrawn
  by chance. On 2026-09-25 QA's property lane run on the BL-1741 parcel
  failed with "generator never reached a suiteOnly plan" (QA note 003196,
  evidence 81fb5df870), and QA held BL-1741's land on it. BL-1583's census
  reads all five files as no-floor, because the floor is asserted through
  this local helper. This feature makes each file reach every kind it
  asserts by construction through the shared helpers, the shape BL-1583's
  sweeps applied. Green runs are QA's e2e steps, not scenarios here.

  # BL-1762 each-bl1252-file-reaches-its-kinds-by-construction-01
  Scenario Outline: each bl1252 property file reaches its plan kinds by construction through the shared helpers
    When the source of <file> is read
    Then it derives a draw count through runsPerCell from helpers/reachFloors
    And it asserts a reach floor through assertReachFloor from helpers/reachFloors

    Examples:
      | file                                                                          |
      | extension/test/bl1252ExpensiveGuardTieringInvariant.property.test.js          |
      | extension/test/bl1252IndexGuardsAllRunInvariant.property.test.js              |
      | extension/test/bl1252RefusalPredicateUnchangedInvariant.property.test.js      |
      | extension/test/bl1252UnexpectedFailureNeverPassesInvariant.property.test.js   |
      | extension/test/bl1252ViolatingGuardsAllNamedInvariant.property.test.js        |

  # BL-1762 census-reads-every-bl1252-file-constructed-02
  Scenario: the sampled reach floor census reads every bl1252 property file as constructed
    When the sampled reach floor census CLI runs
    Then it reads every extension/test/bl1252*.property.test.js file as constructed
    And it reads exactly 5 such files
