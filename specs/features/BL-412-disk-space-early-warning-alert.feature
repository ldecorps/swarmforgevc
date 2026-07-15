Feature: proactive Telegram alert before the swarm's disk fills

  # An overnight ENOSPC took the whole swarm down (agents crash mid-write,
  # parcels/topic-records truncated, git fails, logs can't even be written).
  # A cheap periodic df check on the filesystems the swarm writes to warns the
  # human BEFORE the cliff, change-gated so it never re-announces a steady state.
  # The VHDX-on-C: mechanism means BOTH the WSL root AND /mnt/c must be watched.

  Background:
    Given a disk-space monitor evaluating free space on each watched filesystem against WARN and CRITICAL thresholds

  # BL-412 disk-space-alert-01
  Scenario Outline: free space crossing a threshold downward announces that level once
    Given a watched filesystem previously at level "<prev>"
    When a check finds its free space now at level "<now>"
    Then a single "<now>" alert is delivered naming the mount, free amount, and free percent
    And the monitor records "<now>" as the last-announced level for that filesystem

    Examples:
      | prev     | now      |
      | healthy  | warn     |
      | warn     | critical |
      | healthy  | critical |

  # BL-412 disk-space-alert-02
  Scenario: an unchanged level is not re-announced on the next check
    Given a watched filesystem whose last-announced level is "critical"
    When a check finds its free space still at level "critical"
    Then no alert is delivered
    And the last-announced level for that filesystem stays "critical"

  # BL-412 disk-space-alert-03
  Scenario: recovering above the warn threshold announces a return to healthy
    Given a watched filesystem whose last-announced level is "critical"
    When a check finds its free space back above the warn threshold
    Then a single recovery alert is delivered for that filesystem
    And the monitor records "healthy" as the last-announced level for that filesystem

  # BL-412 disk-space-alert-04
  Scenario: each watched filesystem is evaluated independently
    Given the WSL root filesystem is healthy and the /mnt/c filesystem is at level "critical"
    When a check runs
    Then a "critical" alert is delivered for /mnt/c only
    And no alert is delivered for the WSL root filesystem
