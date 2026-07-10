Feature: Baton fleet composite is trustworthy end-to-end (verified by the children)

  # BL-242 epic-done-01
  Scenario: the epic is complete when every child slice has landed
    Given BL-243, BL-244, BL-245, and BL-246 are each merged and closed
    Then the coordinator is provisioned infrastructure, not a configured role (BL-243)
    And a swarm answers the composite interface by rolling up its agents (BL-244)
    And the swarm degrades gracefully when its coordinator dies (BL-245)
    And the fleet console renders a fleet of one identically to a fleet of many (BL-246)

  # Non-behavioral gate:
  #  - This umbrella carries no code; its acceptance is the union of its children's
  #    acceptance. Do NOT promote BL-242 as a work slice — promote the children in
  #    dependency order: BL-243 -> BL-244 -> {BL-245, BL-246}.
