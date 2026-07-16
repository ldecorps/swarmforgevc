Feature: start-swarm and ensure bring the full stack up, pass the swarm gates, and are documented

  # BL-461 (chore, human-requested via Cursor chat 2026-07-16 — ldecorps, after a WSL reboot killed
  # a 5-day swarm at ~/swarmforgevc). One command must restore EVERYTHING on a headless/WSL host:
  # agent sessions, the handoff daemon, the operator runtime, and — when Telegram is configured — the
  # front-desk supervisor (the Telegram bridge + Front Desk Bot). This extends BL-145's ./swarm ensure
  # (idempotent repair) rather than adding a parallel ensure story, and adds a cold-start path via the
  # host's operator entry point ./start-swarm.sh (the headless wrapper around ./swarm — NOT bare
  # ./swarm from a /mnt/c checkout).
  #
  # A Cursor-side patch already sits on this tree (ungated): swarm_ensure.bb also covers operator +
  # front desk; swarmforge.sh starts ancillary services during a cold launch (best-effort, skip flags
  # honored); start-swarm.sh runs ./swarm ensure after sessions are ready; test_swarm_ensure.sh gained
  # scenarios 05a/05b/05c/06. Cursor ran those green, but a Cursor run is NOT a swarm gate pass — this
  # ticket forces the touched scripts through the normal pipeline so the swarm's own hard gates pass,
  # and the documenter writes the operator-facing restart/repair path.
  #
  # Scope (live paths verified present 2026-07-16 — grep-confirm again at build):
  #   - swarmforge/scripts/swarm_ensure.bb — per-component health: each of agents, handoffd, operator,
  #     and (when configured) front-desk reports HEALTHY, FIXED (naming the repair), or FAILED. Component
  #     start commands are injectable via env seams (SWARM_ENSURE_OPERATOR_CMD /
  #     SWARM_ENSURE_FRONT_DESK_CMD) so the harness never spawns a real bridge.
  #   - swarmforge/scripts/swarmforge.sh — start_ancillary_services during a cold launch (best-effort;
  #     honors skip flags; never aborts agent launch on an ancillary failure).
  #   - start-swarm.sh — after sessions are ready, runs ./swarm ensure so ancillaries are started/repaired.
  #   - swarmforge/scripts/test/test_swarm_ensure.sh — the shell gate for the above.
  #   - Docs: prefer docs/GettingStarted.md and/or README; deep detail may link Specification.MD.
  #
  # Front desk still requires TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID / TELEGRAM_PRINCIPAL_USER_ID in the
  # launching shell env. Related: BL-145 (original ensure), BL-336 G1/G2 (front desk not in the boot
  # path), BL-372 (start-swarm.sh detach).

  # BL-461 start-swarm-ensure-01
  Scenario: A cold start via start-swarm.sh brings up agents and every ancillary
    Given a host with the Telegram front-desk env configured
    When ./start-swarm.sh runs
    Then the agent sessions are up
    And the handoff daemon, operator runtime, and front-desk supervisor are up
    And any ancillary that fails to start is reported failed without aborting the agent launch

  # BL-461 start-swarm-ensure-02
  Scenario: ensure repairs the full stack idempotently and reports each component
    Given the BL-145 ensure behaviour for agents and the handoff daemon
    When ./swarm ensure runs
    Then it also checks the operator runtime and, when configured, the front-desk supervisor
    And each component is reported as HEALTHY, FIXED, or FAILED
    And running ensure again when everything is already up reports every component HEALTHY and changes nothing

  # BL-461 start-swarm-ensure-03
  Scenario Outline: The front desk is checked only when Telegram is configured or a prior front-desk pid exists
    Given Telegram front-desk env is "<telegram_env>"
    And a prior front-desk pid file is "<prior_pid>"
    When ./swarm ensure runs
    Then the front-desk component is "<front_desk>"

    Examples:
      | telegram_env | prior_pid | front_desk |
      | set          | absent    | checked    |
      | unset        | present   | checked    |
      | unset        | absent    | omitted    |

  # BL-461 start-swarm-ensure-04
  Scenario: A skip flag omits its component without aborting the rest
    Given a component's skip flag is set
    When the cold launch or ensure runs
    Then that component is skipped
    And the other components are still brought up or checked

  # BL-461 start-swarm-ensure-05
  Scenario: The touched scripts pass the swarm's own gates
    Given the changes to swarm_ensure.bb, swarmforge.sh, and start-swarm.sh
    When the swarm hard gates for the touched scripts run
    Then they all pass, not merely a Cursor-side run

  # BL-461 start-swarm-ensure-06
  Scenario: The docs name the restart and repair commands with their env and skip flags
    When the documenter pass for this ticket completes
    Then Getting Started and/or the README name ./start-swarm.sh as the restart command and ./swarm ensure as the repair command
    And they document the Telegram env requirements and the skip flags
    And every command and script the docs name exists in the repo
