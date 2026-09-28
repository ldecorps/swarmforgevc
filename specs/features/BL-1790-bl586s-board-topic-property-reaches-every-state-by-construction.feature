Feature: BL-1790 bl586's board topic property reaches every state by construction

  extension/test/bl586PipelineBoardTopicIdentity.property.test.js draws a
  topic map and a stored id 100 times for invariant 1, then asserts that at
  least 5 draws landed on an already-board-bound state, at least 50 on a
  crossed state and at least 5 on an unmapped state. A draw is board-bound
  only when the map carries a board binding (about half the draws) and the
  stored id is drawn from the map's keys (4 in 5) and that key is the board's
  (1 in 2 to 1 in 7 keys): about 1 draw in 9 at uniform odds, so the floor of
  5 misses about 1 run in 65 before fast-check's own biases. On 2026-09-27
  QA's property lane run on the BL-1707 parcel failed with "generator reached
  only 3 already-board-bound states" (QA evidence fd1ab96de0), and the parcel
  is held under Article 4.2 until the red has an owner. Invariant 2's four
  floors over 1000 pinned draws are safe (the loosest misses about 1 run in
  10^14). BL-1583's census reads the file as no-floor, because its assert
  messages say "generator reached only" and the census knows only "the
  generator reached". This feature makes every property in the file reach
  each of its arms by construction through the shared helpers, the shape
  BL-1583's sweeps applied. Green runs are QA's e2e steps, not scenarios here.

  # BL-1790 bl586-reaches-every-state-by-construction-01
  Scenario: bl586's board topic property reaches its states by construction through the shared helpers
    When the source of extension/test/bl586PipelineBoardTopicIdentity.property.test.js is read
    Then it derives a draw count through runsPerCell from helpers/reachFloors
    And it asserts a reach floor through assertReachFloor from helpers/reachFloors

  # BL-1790 census-reads-bl586-constructed-02
  Scenario: the sampled reach floor census reads bl586's board topic property as constructed
    When the sampled reach floor census CLI runs
    Then it reads extension/test/bl586PipelineBoardTopicIdentity.property.test.js as constructed
