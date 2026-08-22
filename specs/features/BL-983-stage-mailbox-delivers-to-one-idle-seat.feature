Feature: BL-983 a parcel addressed to a stage is worked by exactly one of its seats

  BL-982 lets a stage host several seats, but leaves every seat past the first
  inert. This slice makes them real workers: a parcel still addresses the STAGE,
  and exactly one seat of that stage picks it up. Two seats of one stage can
  therefore work two different tickets at the same time - which is the point of
  duplicating a bottleneck seat.

  Motivating concept (named, not implemented here): a more capable coder - a
  stronger-model seat beside a cheaper/faster peer of the same stage (e.g.
  Sonnet beside Fable). This slice only makes that seat a real idle claimant;
  it does not prefer it. Seat choice here is idle-first with a deterministic
  tie-break, deliberately blind to ticket difficulty and to model tier.
  Steering hard tickets to the more capable coder is the next slice and needs
  a human decision this one does not.

  Background:
    Given a stage with two seats, each booted with its own worktree and mailbox

  # BL-983 stage-mailbox-delivers-to-one-idle-seat-01
  Scenario: a parcel addressed to a stage reaches exactly one of its seats
    Given both seats of the stage are idle
    When a parcel addressed to that stage is delivered
    Then exactly one seat is delivered the parcel
    And the other seat is delivered nothing

  # BL-983 stage-mailbox-delivers-to-one-idle-seat-02
  Scenario: two seats of one stage work two tickets at the same time
    Given both seats of the stage are idle
    When two parcels addressed to that stage are delivered
    Then each seat holds one of the two parcels

  # BL-983 stage-mailbox-delivers-to-one-idle-seat-03
  Scenario: a parcel waits when every seat of the stage is busy
    Given every seat of the stage already holds a claimed parcel
    When a parcel addressed to that stage is delivered
    Then the parcel is still queued for the stage
    And no seat holds two claimed parcels

  # BL-983 stage-mailbox-delivers-to-one-idle-seat-04
  Scenario: a seat hands off to the next stage, never to a peer seat
    Given one seat of the stage holds a claimed parcel
    When that seat forwards its work onward
    Then the parcel is addressed to the next stage
    And no seat of its own stage is addressed

  # BL-983 stage-mailbox-delivers-to-one-idle-seat-05
  Scenario: a parcel already claimed by one seat is never handed to another
    Given one seat of the stage holds a claimed parcel
    When the same parcel is delivered again
    Then the other seat is delivered nothing
    And the claiming seat still holds exactly one copy
