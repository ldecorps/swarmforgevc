Feature: a single-role repair command can never reach beyond its own session

  BL-1018: on 2026-08-21 ~08:26 UTC an operator single-role respawn of the
  specifier (create session, then respawn-pane) took down the ENTIRE pack tmux
  server - socket 3752320954, handoffd included - and recovery needed a full
  ./start-swarm.sh. BL-958 named the same hazard: respawn issued against a
  missing session can restart a half-alive tmux server.

  This slice constrains what a single-role repair is allowed to RESOLVE TO. It
  pins the resolution, which is pure and testable; it does not itself drive
  tmux.

  Background:
    Given a pack whose tmux socket is known

  # BL-1018 single-role-respawn-never-kills-the-server-01
  Scenario: a missing session is created, never respawned into
    Given role "specifier" whose session is missing
    When a single-role repair is resolved for that role
    Then the resolved commands create that role's session
    And no resolved command is a respawn-pane against the missing session

  # BL-1018 single-role-respawn-never-kills-the-server-02
  Scenario: an existing session is respawned in place, not recreated
    Given role "specifier" whose session exists
    When a single-role repair is resolved for that role
    Then the resolved commands respawn that role's pane
    And no resolved command creates a session that already exists

  # BL-1018 single-role-respawn-never-kills-the-server-03
  Scenario Outline: no resolved command can affect anything but its own target
    Given role "specifier" whose session is <session state>
    When a single-role repair is resolved for that role
    Then every resolved command names the pack socket explicitly
    And every resolved command targets only that role's own session
    And no resolved command is a kill-server or a kill-session

    Examples:
      | session state |
      | missing       |
      | present       |
