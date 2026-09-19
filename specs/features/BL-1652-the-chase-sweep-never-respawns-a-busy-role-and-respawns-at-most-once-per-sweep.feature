Feature: BL-1652 The chase sweep never respawns a busy role and respawns at most once per sweep

  Once an inbox item on a role has been chased three times and the role's
  liveness reads dead from a stale heartbeat, the chase sweep respawns the
  role, once per such item, without looking at the role's own pane or the
  lane running under its worktree. On 2026-09-19 that respawned QA seven
  times in one tick in the middle of an eighty-minute land, then again six
  minutes later, and the daemon's log said nothing about why. After this
  parcel a role whose pane shows the busy footer or whose worktree has a
  lane running is never respawned, a sweep respawns a role at most once,
  and every respawn writes one line with the readings it was decided on.

  Background:
    Given a fixture root with a daemon-shaped .swarmforge, a QA role whose heartbeat is ten minutes old, and five inbox items on QA each already chased three times

  # BL-1652 a-busy-pane-is-never-respawned-01
  Scenario: a role whose own pane shows the busy footer is chased, never respawned
    Given the QA pane capture carries the busy footer
    When the daemon's chase sweep runs once on the fixture root
    Then no chase-respawn line is logged for QA
    And no respawn is triggered for QA

  # BL-1652 a-running-lane-is-never-respawned-02
  Scenario: a role with a test lane running under its worktree is never respawned even with a dead heartbeat and a quiet pane
    Given the QA pane capture carries no busy footer
    And a test lane process is running with the QA worktree as its working directory
    When the daemon's chase sweep runs once on the fixture root
    Then no chase-respawn line is logged for QA
    And no respawn is triggered for QA

  # BL-1652 a-dead-role-is-respawned-once-per-sweep-with-its-reasons-03
  Scenario: a genuinely dead role with five stuck items is respawned exactly once and the line carries every reading
    Given the QA pane capture carries no busy footer
    And no test lane process is running under the QA worktree
    When the daemon's chase sweep runs once on the fixture root
    Then exactly one respawn is triggered for QA
    And exactly one chase-respawn line is logged for QA naming the triggering item, the liveness state, the heartbeat age, the pane activity age, the busy reading and the lane reading
    And the chaser telemetry carries one respawn row for QA with the same readings

  # BL-1652 the-other-items-keep-their-counts-04
  Scenario: the items that did not trigger the single respawn keep their chase counts and sidecars unchanged
    Given the QA pane capture carries no busy footer
    And no test lane process is running under the QA worktree
    When the daemon's chase sweep runs once on the fixture root
    Then the four items that did not trigger the respawn carry the same chase count as before the sweep
