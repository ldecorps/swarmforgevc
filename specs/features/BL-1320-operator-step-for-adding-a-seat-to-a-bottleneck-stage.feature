Feature: BL-1320 the operator step for adding or removing a seat of a bottleneck stage is documented and executable as written

  BL-982 made a pack able to declare a second seat of one stage with its own
  model, and BL-1001 routes work between them by difficulty. What is missing is
  the operator-facing step: when the optimizer names a stage as the bottleneck,
  nothing tells the operator how to add a seat there, or WHICH model tier to
  add when the constraint is capacity at a particular difficulty band. The
  how-to this ticket writes is only worth having if it stays true, so its
  documented window line is exercised against a real pack parse rather than
  asserted in prose.

  Background:
    Given the how-to page documenting how to add and remove a seat of a stage

  # BL-1320 documented-add-line-parses-01
  Scenario: the documented "add a seat" window line produces two seats of one stage
    Given a fixture pack carrying the how-to's documented second-seat window line
    When the pack is parsed for launch
    Then the stage has two seats
    And each seat carries its own model

  # BL-1320 documented-remove-restores-one-seat-02
  Scenario: the documented "remove a seat" step returns the stage to one seat
    Given a fixture pack with two seats of one stage
    When the how-to's documented removal step is applied to that pack
    And the pack is parsed for launch
    Then the stage has one seat
    And that seat is the bare stage-named seat

  # BL-1320 tier-guidance-names-a-band-03
  Scenario: the tier guidance names which model tier to add for a difficulty band
    When the how-to's tier guidance is read for a stage whose constraint is capacity at a difficulty band
    Then it names the model tier to add for that band
    And it names the steward command that lists the models ranked for that role

  # BL-1320 bare-seat-requirement-is-stated-04
  Scenario: the how-to states the constraint a second seat cannot violate
    When the how-to's add step is read
    Then it states that a stage declaring an extra seat must also declare its bare stage-named seat
