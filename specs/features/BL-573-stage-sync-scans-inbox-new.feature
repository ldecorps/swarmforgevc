Feature: The pipeline board's stage sync sees parcels still queued in inbox/new

  The stage sync scrapes each role's inbox/in_process only, so a parcel that
  has been DELIVERED to a role but not yet dequeued is invisible and the ticket
  keeps showing at its previous stage. On a mono-router pack that is the normal
  case rather than an edge: five of the seven pipeline roles are dormant, and
  their parcels sit in inbox/new for as long as it takes the resident to rotate
  into that role.

  Widening the scan needs no new precedence rule. The existing reconciliation
  already resolves a ticket seen at more than one role by pipeline rank —
  the role further downstream wins — which is the correct answer here too: a
  parcel queued at a downstream role has advanced past the upstream role still
  holding it in process.

  Background:
    Given a ticket that is present in backlog/active

  # BL-573 stage-sync-new-01
  Scenario: a parcel waiting in a dormant role's queue places the ticket at that role
    Given the ticket's parcel is queued at "documenter"
    And no role holds the ticket in process
    When the stage sync runs
    Then the ticket's stage is "documenter"

  # BL-573 stage-sync-new-02
  Scenario: a queued downstream parcel outranks an in-process upstream one
    Given the ticket's parcel is queued at "QA"
    And the ticket is held in process at "coder"
    When the stage sync runs
    Then the ticket's stage is "QA"
    And the ticket appears exactly once in the stage map

  # BL-573 stage-sync-new-03
  Scenario: one role holding the ticket in both its queues yields a single row
    Given the ticket's parcel is queued at "cleaner"
    And the ticket is held in process at "cleaner"
    When the stage sync runs
    Then the ticket's stage is "cleaner"
    And the ticket appears exactly once in the stage map

  # BL-573 stage-sync-new-04
  Scenario: a queued parcel for a non-active ticket is still excluded
    Given the ticket is absent from backlog/active
    And the ticket's parcel is queued at "coder"
    When the stage sync runs
    Then the ticket has no stage in the stage map
