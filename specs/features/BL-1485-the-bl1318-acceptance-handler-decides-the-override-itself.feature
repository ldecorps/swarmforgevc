# mutation-stamp: sha256=34d2ac73c94d4475221b9a1bf0abfa0d9b778d36da9e66e9fde9852af6a99977
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-13T13:06:07.220648402Z","feature_name":"BL-1485 The BL-1318 acceptance handler decides the operator override itself","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1485-the-bl1318-acceptance-handler-decides-the-override-itself.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"BL-1318's feature passes every scenario whatever the pane exports for the override","scenario_hash":"5976ff145eb09b8596a343a103b783f682ebcfdd683d2671eb2b213823e4843a","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-09-13T13:06:07.220648402Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1485 The BL-1318 acceptance handler decides the operator override itself

  specs/pipeline/steps/bl1318PackStaffingGateSteps.js drives the real
  launcher's parse_config against fixture roots and asserts that an
  uncleared seat is refused. It spawns with the pane's environment spread
  in, and every role pane exports the operator escape hatch
  PACK_STAFFING_SKIP_GATE=1, so inside the swarm the launcher turns every
  refusal into an OVERRIDE warning and four of BL-1318's seven scenario rows
  fail; the same feature is green in a shell without the hatch. BL-1445
  fixed this inheritance in the shell lane and BL-1457 in the vitest lane;
  this feature is the acceptance lane: the handler sets or removes the
  variable itself in the environment it spawns, so BL-1318's verdict is the
  same in a role pane, an offline expedite shell, and under env -i.

  # BL-1485 the-staffing-gate-feature-passes-under-every-pane-export-01
  Scenario Outline: BL-1318's feature passes every scenario whatever the pane exports for the override
    Given the pane environment exports PACK_STAFFING_SKIP_GATE as <value>
    When the BL-1318 staffing-gate feature runs
    Then it passes every scenario

    Examples:
      | value |
      | 1     |
      | 0     |
      | unset |

  # BL-1485 every-launcher-handler-that-asserts-on-the-gate-decides-the-override-itself-02
  Scenario: every step handler that spawns the launcher and asserts on the staffing gate decides the override itself
    When every step handler under specs/pipeline/steps that spawns swarmforge.sh is inspected
    Then each one that asserts on the staffing gate's refusal or override warning sets or removes PACK_STAFFING_SKIP_GATE explicitly in the environment it spawns
