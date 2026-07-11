Feature: The Concierge tick routes a NeedsApproval event into the gated item's BL-### topic

  Background:
    Given the Concierge tick reads the swarm's live gate state alongside its backlog

  # BL-301 needs-approval-01
  Scenario Outline: a newly-gated role holding <holding>
    Given a role newly awaiting a human decision while holding <holding>
    When the tick derives and routes events
    Then <result>

    Examples:
      | holding | result |
      | a backlog item | a NeedsApproval message is posted into that backlog item's topic |
      | no backlog item | no NeedsApproval message is posted anywhere |

  # BL-301 needs-approval-02
  Scenario: a NeedsApproval whose post fails is retried on the next tick
    Given a NeedsApproval whose post failed while the role stays gated
    When the tick runs again
    Then the NeedsApproval is routed again rather than dropped for good
