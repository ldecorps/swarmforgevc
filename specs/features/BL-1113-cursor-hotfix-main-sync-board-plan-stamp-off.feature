# mutation-stamp: sha256=3b55e1667cc47e1f0ff2ac45408796ca8393520b41d2d233159357f23c49f7d3
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T07:31:04.908228342Z","feature_name":"BL-1113 stamp-off of Cursor hotfix 27273f2b0a","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1113-cursor-hotfix-main-sync-board-plan-stamp-off.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"main_sync_status_cli names the only allowed coordinator action","scenario_hash":"99a1fe20273ac92e861bc7b26730d75ab705bb37ca3ea01a4a10b169da2f2798","mutation_count":16,"result":{"Total":16,"Killed":16,"Survived":0,"Errors":0},"tested_at":"2026-08-24T07:31:04.908228342Z"},{"index":3,"name":"Pipeline Board HTML keeps stage spacing and uses three-word slugs","scenario_hash":"21030954539d402b8b1cbeb72098e6424a44db1c75e81bdd667a4100ca1b0e77","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-24T07:31:04.908228342Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1113 stamp-off of Cursor hotfix 27273f2b0a
  Commit 27273f2b0a is a human-landed hotfix already on local main with
  Hotfix-Certification: pending. It bundles four landed behaviours: the
  coordinator step-0 main-sync gate and trip-once deadlock breaker, the
  standing cursor-forge pack, Pipeline Board HTML &nbsp; plus 3-word slugs,
  and Telegram Cursor Remote CreatePlan Confirm/Reject.

  This ticket stamps that landed work off — confirm or refute, do not
  reimplement. A human certifies or waives via the Approvals flow and the
  hotfix ledger; green tests alone never certify.

  # BL-1113 main-sync-status-01
  Scenario Outline: main_sync_status_cli names the only allowed coordinator action
    Given local main is <ahead> ahead and <behind> behind origin/main
    And the deadlock marker is <deadlock>
    When main_sync_status_cli reports sync status
    Then the action is <action>

    Examples:
      | ahead | behind | deadlock | action            |
      | 0     | 0      | clear    | proceed           |
      | 0     | 2      | clear    | ff-only           |
      | 3     | 1      | clear    | wait-reconcile    |
      | 3     | 1      | active   | deadlock-tripped  |

  # BL-1113 main-sync-deadlock-02
  Scenario: a tripped main-sync deadlock suppresses drop-nudges until behind is zero
    Given the main-sync deadlock marker is active
    And origin/main has commits the local tip has not absorbed
    When handoffd considers a dropped-parcel nudge
    Then the nudge is suppressed for main-sync-deadlock
    And the deadlock alert has been raised at most once for that trip

  # BL-1113 cursor-forge-pack-03
  Scenario: cursor-forge is a standing full-forge Cursor pack at depth 3
    Given the pack file swarmforge/packs/cursor-forge.conf
    When the pack is read
    Then rotation is standing
    And active_backlog_max_depth is 3
    And remote_control is off
    And every pipeline window uses the cursor agent token

  # BL-1113 pipeline-board-ux-04
  Scenario Outline: Pipeline Board HTML keeps stage spacing and uses three-word slugs
    Given a ticket titled "<title>"
    When the Pipeline Board HTML body is rendered
    Then the kebab slug is "<slug>"
    And the stage header uses an HTML nbsp entity between DC and QA

    Examples:
      | title                              | slug                 |
      | fix the widget                     | fix-the-widget       |
      | Pipeline Board: Post The New Message | pipeline-board-post |

  # BL-1113 create-plan-confirm-05
  Scenario: a CreatePlan tool call surfaces Confirm plan and Reject plan on Telegram
    Given a Cursor bridge progress event that carries a CreatePlan body
    When the Telegram Cursor Remote live path handles that event
    Then a plan-confirm prompt is posted with Confirm plan and Reject plan buttons
    And a pending plan-confirm record is written for that plan
