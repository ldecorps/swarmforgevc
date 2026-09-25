# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-25T22:43:54.573909863Z","feature_name":"BL-1763 bl1517's root-arg property reaches every site by construction","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1763-bl1517s-root-arg-property-reaches-every-site-by-construction.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: BL-1763 bl1517's root-arg property reaches every site by construction

  extension/test/bl1517ProjectRootArgInvariants.property.test.js draws a
  site from its six wired sites 30 times (fc.constantFrom) and afterwards
  asserts every site was drawn. Its second property draws one of three
  harnesses 15 times and asserts all three. A uniform 30-draw run misses at
  least one of six sites about 1 run in 40. On 2026-09-25 QA's property
  lane run on the BL-1744 parcel reached five of six (QA evidence
  01b2e061f7), and QA held BL-1744's land on it. BL-1583's census reads the
  file as no-floor, because the floor is an equality on a Set's size. This
  feature makes both properties reach every site and harness by
  construction through the shared helpers, the shape BL-1583's sweeps
  applied. Green runs are QA's e2e steps, not scenarios here.

  # BL-1763 bl1517-reaches-every-site-by-construction-01
  Scenario: bl1517's root-arg property reaches its sites by construction through the shared helpers
    When the source of extension/test/bl1517ProjectRootArgInvariants.property.test.js is read
    Then it derives a draw count through runsPerCell from helpers/reachFloors
    And it asserts a reach floor through assertReachFloor from helpers/reachFloors

  # BL-1763 census-reads-bl1517-constructed-02
  Scenario: the sampled reach floor census reads bl1517's root-arg property as constructed
    When the sampled reach floor census CLI runs
    Then it reads extension/test/bl1517ProjectRootArgInvariants.property.test.js as constructed
