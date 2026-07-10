Feature: chase/nudge sidecars never orphan in an inbox new/ directory

  A chase/nudge sidecar (<handoff>.chase.json or <handoff>.nudge) is ephemeral
  state that only matters while its parent .handoff still waits in inbox/new/.
  It must never outlive the parent's presence there: once the parent handoff
  leaves new/ (dequeued to in_process/, or already gone), the now-orphaned
  sidecar is removed rather than left to accumulate. Only sidecar-suffixed files
  are ever removed; any other file is left untouched.

  Background:
    Given a role mailbox with an inbox/new/ directory

  # BL-232 sidecar-not-orphaned-on-dequeue-01
  Scenario Outline: dequeuing a handoff leaves no orphaned sidecar behind
    Given a queued handoff H in inbox/new/ with a "<suffix>" sidecar beside it
    And the role's receive mode is "<mode>"
    When the role dequeues its next work
    Then H is no longer in inbox/new/
    And no "<suffix>" sidecar for H remains in inbox/new/

    Examples:
      | suffix      | mode  |
      | .chase.json | task  |
      | .nudge      | task  |
      | .chase.json | batch |

  # BL-232 orphaned-sidecar-reaped-02
  Scenario Outline: a sidecar whose parent handoff is already gone is reaped
    Given a "<suffix>" sidecar in inbox/new/ with no matching .handoff present
    When the handoff sweep runs
    Then the orphaned "<suffix>" sidecar is removed from inbox/new/

    Examples:
      | suffix      |
      | .chase.json |
      | .nudge      |

  # BL-232 live-sidecar-preserved-03
  Scenario: a sidecar is preserved while its parent handoff still waits in new/
    Given a queued handoff H in inbox/new/ with a ".chase.json" sidecar beside it
    And H has not yet been dequeued
    When the handoff sweep runs
    Then H and its ".chase.json" sidecar both remain in inbox/new/

  # BL-232 non-sidecar-file-untouched-04
  Scenario: a non-sidecar file in new/ is never removed
    Given a file "notes.txt" that is not a chase/nudge sidecar in inbox/new/
    When the role dequeues its next work
    And the handoff sweep runs
    Then "notes.txt" still exists in inbox/new/
