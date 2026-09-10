Feature: BL-1505 A dedup-suppressed chase still counts toward respawn and dead-letter

  Since the wake dedup landed (cbe63cceba, 2026-08-27) a chase whose wake
  text the dedup withholds as unchanged-mailbox returns false from the
  wake adapter, and chase_sweep_lib writes the chase sidecar and logs the
  chase only when the adapter returns true. A parcel sitting in an
  unchanged inbox is therefore woken once and never counted again: its
  chaseCount stays at 0, decide-stale-item-action answers "chased" forever,
  and the respawn and dead-letter rungs are unreachable for a live pane
  that ignores its wake. test_handoffd_wake_attribution_wiring.sh case 05
  has been red on main since that day for exactly this: the inbox-item
  wake lands, the chase seconds later is suppressed, no sidecar appears.
  This feature is that a chase attempt counts whether or not its wake text
  was injected, because the pane already carries the text - the ladder
  measures attempts to reach the role, not bytes typed.

  # BL-1505 dedup-suppressed-chase-still-counts-01
  Scenario: the attribution wiring test is green on the tree as it stands
    When swarmforge/scripts/test/test_handoffd_wake_attribution_wiring.sh runs against the real daemon
    Then every case passes, case 05 among them

  # BL-1505 dedup-suppressed-chase-still-counts-02
  Scenario: a chase whose wake was dedup-suppressed advances the chase count
    Given an aged parcel in a role's inbox whose mailbox is unchanged since the role's last wake
    When the chase sweep chases it
    Then the parcel's chase sidecar records one more chase
    And a chase telemetry event is logged for it
    And the wake is attributed as skipped with reason unchanged-mailbox

  # BL-1505 dedup-suppressed-chase-still-counts-03
  Scenario: the ladder reaches respawn for a parcel whose wakes were all suppressed
    Given a parcel chased maxChases times with every wake dedup-suppressed
    When the chase sweep decides its next action
    Then the decision is the same as for a parcel whose wakes all landed
