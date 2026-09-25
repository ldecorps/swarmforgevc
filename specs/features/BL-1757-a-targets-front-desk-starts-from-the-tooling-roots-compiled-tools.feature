Feature: BL-1757 A target's front desk and Cursor Remote bridge start from the tooling root's compiled tools

  launch_front_desk.sh and start_cursor_bridge.sh resolve their node
  entrypoints under "$ROOT/extension/out/tools/", where $ROOT is the
  project the swarm serves. That holds only for swarmforgevc, which builds
  the extension it runs. Any other target has no extension/ of its own, so
  on 2026-09-25 gpu-bargain-hunter launched with no Telegram front desk and
  no Cursor Remote. A pack conf may now name the swarmforgevc checkout
  whose compiled tools serve it (config tooling_root), and both launchers
  start their entrypoints from there while still serving the target.

  # BL-1757 conf-records-the-tooling-root-01
  Scenario: a pack conf's tooling_root line is exported to the services the launch starts
    Given a pack conf carrying "config tooling_root" with an absolute tooling root
    When the pack conf is parsed
    Then SWARMFORGE_TOOLING_ROOT names that tooling root

  # BL-1757 entrypoints-resolve-under-the-tooling-root-02
  Scenario Outline: a launcher serving a target without extension/ starts its entrypoint from the tooling root
    Given a target with no extension/ directory of its own
    And SWARMFORGE_TOOLING_ROOT names a tooling root holding the compiled <entrypoint>
    When <launcher> is dry-run for the target
    Then the <entrypoint> it would start is under the tooling root
    And the project root it would serve is the target

    Examples:
      | launcher               | entrypoint                 |
      | launch_front_desk.sh   | start-bridge-headless.js   |
      | launch_front_desk.sh   | telegram-front-desk-bot.js |
      | start_cursor_bridge.sh | telegram-cursor-bridge.js  |

  # BL-1757 swarmforgevc-resolves-as-today-03
  Scenario: a project that holds its own compiled tools and names no tooling root resolves exactly as today
    Given a project root holding its own compiled extension/out and no SWARMFORGE_TOOLING_ROOT
    When launch_front_desk.sh is dry-run for that project
    Then every entrypoint it would start is under the project root's own extension/out

  # BL-1757 nowhere-to-start-from-is-loud-04
  Scenario: a target with neither its own compiled tools nor a tooling root is refused by name
    Given a target with no extension/ directory of its own
    And no SWARMFORGE_TOOLING_ROOT
    When launch_front_desk.sh runs for the target
    Then it exits non-zero naming both places it looked for the bridge entrypoint
    And nothing is started
