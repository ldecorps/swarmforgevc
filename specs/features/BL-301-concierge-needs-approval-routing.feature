# mutation-stamp: sha256=537e4b0010e88bb9af59b0bf67b898519841cae89f248b5e3ea80746c603b818
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-11T18:06:18.925850746Z","feature_name":"The Concierge tick routes a NeedsApproval event into the gated item's BL-### topic","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-301-concierge-needs-approval-routing.feature","background_hash":"58e744da2589600902e172f5091a180092d62a4b24caeb5e3687483981b03b99","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a newly-gated role holding <holding>","scenario_hash":"851b6b8e1f370e8857ea02c5d6de1409fa983dc67bbff7699adb8f4745e0c91c","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-07-11T18:06:18.925850746Z"}]}
# acceptance-mutation-manifest-end

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
