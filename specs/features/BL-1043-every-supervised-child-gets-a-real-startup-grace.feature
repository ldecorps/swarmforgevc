Feature: Every supervised child gets a real startup grace

  The onboarder and negotiation-relay supervisors call a staleness check
  through a convenience arity that passes the spawn time as nil. The grace
  clause tests that spawn time first, so it can never fire: those two
  supervisors have no startup grace at all, and a child with no heartbeat yet
  is stale on the first tick. Measured live, a child was declared stalled
  2.00 seconds after spawn against a declared 120-second window.

  The cursor-bridge supervisor already gets both halves right - it passes a
  real grace, and it clears the stale heartbeat at spawn so the guard is
  judging the new child rather than the dead one's leftovers.

  Background:
    Given a supervisor whose child reports liveness by heartbeat

  # BL-1043 every-supervised-child-gets-a-real-startup-grace-01
  Scenario: a freshly spawned child is not declared stalled inside its grace
    Given a child that has just been spawned and has written no heartbeat
    When the supervisor checks it inside the startup grace
    Then the child is not declared stalled

  # BL-1043 every-supervised-child-gets-a-real-startup-grace-02
  Scenario: the guard is still armed once the grace has passed
    Given a child that has just been spawned and has written no heartbeat
    When the supervisor checks it after the startup grace has passed
    Then the child is declared stalled
    And the stall is recorded with the window it exceeded

  # BL-1043 every-supervised-child-gets-a-real-startup-grace-03
  Scenario: a heartbeat left by a dead instance does not condemn its replacement
    Given a heartbeat file left behind by an instance that is no longer running
    And a child that has just been spawned
    When the supervisor checks it inside the startup grace
    Then the child is not declared stalled

  # BL-1043 every-supervised-child-gets-a-real-startup-grace-04
  Scenario: a heartbeat written during the grace clears the concern
    Given a child that has just been spawned
    And the child writes its first heartbeat inside the startup grace
    When the supervisor checks it inside the startup grace
    Then the child is not declared stalled

  # BL-1043 every-supervised-child-gets-a-real-startup-grace-05
  Scenario: a staleness check that was never asked for a grace still applies one
    Given a staleness check called without an explicit startup grace
    And a child that has just been spawned and has written no heartbeat
    When the supervisor checks it inside the startup grace
    Then the child is not declared stalled
