# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-25T21:28:59.674231131Z","feature_name":"BL-1760 bl1074's reach floors are constructed","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1760-bl1074s-reach-floors-are-constructed.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: BL-1760 bl1074's reach floors are constructed

  extension/test/bl1074PostCloseRefileDuration.property.test.js draws
  (refileCount 0..3, copyClose boolean) 12 times and afterwards asserts at
  least 2 cases reached a re-file and at least 2 a copy-close. A fair coin
  misses the copy-close floor by chance, and on 2026-09-25 QA's property
  lane run drew 1 copy-close in 12 (QA note 003193) with nothing wrong in
  the code. BL-1583's census never listed the file: its classifier reads
  it as no-floor with budget 8, because it takes the other test's literal
  and does not bind the floor to "{ numRuns }". This feature makes the
  file reach both floors by construction through the shared helpers, the
  shape sweeps 1-4 applied, at the floors' unchanged values. Green runs
  are QA's e2e steps, not scenarios here.

  # BL-1760 bl1074-reaches-its-floors-by-construction-01
  Scenario: bl1074 reaches its floors by construction through the shared helpers
    When the source of extension/test/bl1074PostCloseRefileDuration.property.test.js is read
    Then it derives a draw count through runsPerCell from helpers/reachFloors
    And it asserts a reach floor through assertReachFloor from helpers/reachFloors

  # BL-1760 census-reads-bl1074-constructed-02
  Scenario: the sampled reach floor census reads bl1074 as constructed
    When the sampled reach floor census CLI runs
    Then it reads extension/test/bl1074PostCloseRefileDuration.property.test.js as constructed
