# mutation-stamp: sha256=403aef5ed523036cc088b59e109cd5b7eca8fff42e71c1313cc3afc0afe74220
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-10T07:17:52.338202394Z","feature_name":"chase/nudge sidecars never orphan in an inbox new/ directory","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-232-chase-nudge-sidecars-never-orphan.feature","background_hash":"d033d1ae8b579da310d58742865ef8a4b20aa1998c739286e6b1f2e04811410c","implementation_hash":"unknown","scenarios":[{"index":0,"name":"dequeuing a handoff leaves no orphaned sidecar behind","scenario_hash":"cbbfc3b10b045e71b3195260fea664eb98732e42f3ecc908d91f659a2425f543","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-07-10T07:17:38.742016011Z"},{"index":1,"name":"a sidecar whose parent handoff is already gone is reaped","scenario_hash":"59bad4898928ab787c212ee1e95c94e548c1e217c938e118334a0c3c72f6ab38","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-10T07:17:05.567963809Z"}]}
# acceptance-mutation-manifest-end

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
