Feature: BL-1786 bl1012's freshness property reaches capped and uncapped by construction

  extension/test/bl1012FreshnessSelfInflictedIncidents.property.test.js
  draws a load (0..400) and a core count (1..16) 40 times for invariant 1,
  then asserts that at least 5 draws were uncapped (contention factor
  load/cores at most 5) and at least 5 capped. Only about 1 draw in 8 is
  uncapped at uniform odds, so the uncapped floor misses about 4 runs in 10
  before fast-check's bias toward small values. Invariant 2's inside-grace
  floor (5 of 40 with elapsed under 300 of 1..900) misses about 1 run in
  1,500. On 2026-09-26 QA's property lane run on the BL-1779 parcel failed
  with "generator reached only 4 uncapped states" (QA evidence
  BL-1779-QA-20260926). BL-1583's census reads the file as no-floor,
  because its assert messages say "generator reached only" and the census
  knows only "the generator reached". This feature makes every property in
  the file reach both of its arms by construction through the shared
  helpers, the shape BL-1583's sweeps applied. Green runs are QA's e2e
  steps, not scenarios here.

  # BL-1786 bl1012-reaches-both-arms-by-construction-01
  Scenario: bl1012's freshness property reaches its arms by construction through the shared helpers
    When the source of extension/test/bl1012FreshnessSelfInflictedIncidents.property.test.js is read
    Then it derives a draw count through runsPerCell from helpers/reachFloors
    And it asserts a reach floor through assertReachFloor from helpers/reachFloors

  # BL-1786 census-reads-bl1012-constructed-02
  Scenario: the sampled reach floor census reads bl1012's freshness property as constructed
    When the sampled reach floor census CLI runs
    Then it reads extension/test/bl1012FreshnessSelfInflictedIncidents.property.test.js as constructed
