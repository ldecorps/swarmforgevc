Feature: mono-router rotation dynamics emit a trended telemetry series

  # BL-596 (epic BL-594): Single-resident mono-router rotates personas; stageDwell
  # cannot show per-persona health. Emit rotation events to rotation-YYYY-MM.jsonl;
  # pure aggregator yields dwell shares, rotations/day, thrash, time stranded off-home.
  # Empty/NA on non-mono-router packs. Observability only — mono_router_lib unchanged.

  Background:
    Given a mono-router pack with a single rotating resident

  # BL-596 rotation-event-emits-01
  Scenario: each rotation emits one rotation event with from to reason and timestamp
    When the resident rotates from one persona to another with a recorded reason
    Then exactly one event is appended to the rotation telemetry log
    And the event carries from-role to-role reason and timestamp fields

  # BL-596 pure-aggregator-metrics-02
  Scenario: a pure aggregator produces dwell shares rotations per day and stranded time
    Given a fixture stream of rotation events over a time window
    When the rotation dynamics aggregator runs without filesystem access
    Then it reports per-persona dwell shares for that window
    And it reports rotations per day and cumulative time stranded off-home

  # BL-596 thrash-distinct-03
  Scenario: thrash rotations are counted separately from ordinary rotations
    Given rotation events that flip back to the prior persona within the thrash window
    And rotation events that are ordinary persona changes
    When the rotation dynamics aggregator runs
    Then thrash rotations are counted distinctly from non-thrash rotations

  # BL-596 non-mono-router-empty-04
  Scenario: a non-mono-router pack yields an empty series without error
    Given an active pack that is not a mono-router rotation model
    When rotation dynamics telemetry is queried
    Then the series is empty or marked not applicable
    And no error is raised
