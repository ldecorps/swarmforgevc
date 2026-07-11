Feature: The stage-dwell endpoint test is deterministic under a fixed clock

  Background:
    Given a completed handoff fixture whose dequeued_at and completed_at are built from a fixed reference instant
    And the same fixed instant is injected as the stage-dwell evaluation time

  # BL-270 stage-dwell-fixed-clock-01
  Scenario: the stage-dwell result is stable across repeated runs
    When the stage-dwell report is computed for the fixture
    Then it counts the fixture parcel as processed in the window
    And it names the fixture's role as the bottleneck
    And the same inputs always produce the same result, with no dependence on the real clock
