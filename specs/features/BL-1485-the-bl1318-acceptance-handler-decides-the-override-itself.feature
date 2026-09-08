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
