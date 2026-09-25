Feature: BL-1714 A QA lane run in flight holds the chase respawn

  On 2026-09-24 QA ran its checklist gatherer for BL-1694 in the
  background and waited for it. The chase ladder chased QA sixteen times
  and then respawned it, killing a gather run that had been alive for
  thirty-one minutes under QA's own worktree. BL-1652's lane guard exists
  to prevent exactly this, but its process pattern names Stryker, vitest
  and the bb test runners, not the gatherer or the acceptance CLI QA
  runs directly. On 2026-09-25 the same ladder respawned QA every six
  minutes while it waited on a land step, killing every land mid-flight;
  hotfix 72d2da04da added the land commands to the pattern, and this
  feature stamps that too. This feature is that any of these runs,
  scoped to the chased role's worktree, holds the respawn, and that a run
  under another role's worktree still does not.

  Background:
    Given a fixture root with a daemon-shaped .swarmforge, a QA role whose heartbeat is ten minutes old, and five inbox items on QA each already chased three times
    And the QA pane capture carries no busy footer

  # BL-1714 a-qa-lane-run-under-the-qa-worktree-holds-the-respawn-01
  Scenario Outline: a lane run QA starts directly, alive under the QA worktree, is never respawned over
    Given a "<lane command>" process is running with the QA worktree as its working directory
    When the daemon's chase sweep runs once on the fixture root
    Then no respawn is triggered for QA

    Examples:
      | lane command                                                   |
      | node extension/out/tools/qa-gather.js --ticket BL-9999          |
      | node specs/pipeline/cli.js specs/features/BL-9999-a.feature     |
      | bb swarmforge/scripts/land_step_cli.bb BL-9999 0123456789       |
      | swarmforge/scripts/land_main_publish.sh . --decide-only         |

  # BL-1714 a-lane-run-under-another-worktree-does-not-hold-qa-02
  Scenario: a gather run under the coder worktree leaves QA's respawn to its own readings
    Given a "node extension/out/tools/qa-gather.js --ticket BL-9999" process is running with the coder worktree as its working directory
    When the daemon's chase sweep runs once on the fixture root
    Then exactly one respawn is triggered for QA
