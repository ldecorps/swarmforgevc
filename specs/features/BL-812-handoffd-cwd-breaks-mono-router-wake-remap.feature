Feature: BL-812 handoffd cwd breaks mono-router wake remap
  handoffd receives its project root on argv, but handoff-lib resolves
  target-root-scoped state (roles.tsv, mono-router-active-role, tmux-socket,
  launch scripts) from process cwd via `git rev-parse --git-common-dir`. When
  the daemon's cwd is not the project root, every one of those reads silently
  resolves against the wrong root: the resident looks absent, chase degrades to
  waking the dormant role's own session name, and the inject fails forever
  against a session mono-router never creates.

  Background:
    Given a mono-router project root whose roles.tsv names the coordinator and the resident session "swarmforge-coder"
    And that project root has a launch script for every pipeline role
    And handoffd is started with that project root as its argv project-root
    And handoffd's process cwd is a directory outside that project root

  # BL-812 handoffd-cwd-wake-remap-01
  Scenario Outline: root-scoped state resolves from the argv project root, not from cwd
    When handoffd resolves <root_scoped_read>
    Then it resolves to <expected_value>
    And it does not resolve under handoffd's cwd

    Examples:
      | root_scoped_read                 | expected_value                                |
      | the mono-router resident session | swarmforge-coder                              |
      | the mono-router home role        | coder                                         |
      | the mono-router active role      | the role recorded in the project's state dir  |
      | the tmux socket path             | the project's .swarmforge tmux-socket contents |
      | the launch script for architect  | the project's architect launch script          |

  # BL-812 handoffd-cwd-wake-remap-02
  Scenario: a dormant role's wake remaps to the resident under foreign cwd
    Given only the resident and coordinator tmux sessions exist
    When handoffd resolves the wake session for the architect session name
    Then the wake session is swarmforge-coder
    And no wake is addressed to swarmforge-architect

  # BL-812 handoffd-cwd-wake-remap-03
  Scenario: wake remap is identical from the project cwd and from a foreign cwd
    Given only the resident and coordinator tmux sessions exist
    When the wake session for the hardender session name is resolved from the project root cwd
    And the wake session for the hardender session name is resolved from a foreign cwd
    Then both resolutions return the same session name

  # BL-812 handoffd-cwd-wake-remap-04
  Scenario: chase rotates the resident onto a dormant role holding actionable mail
    Given only the resident and coordinator tmux sessions exist
    And the architect inbox holds an actionable git_handoff
    And the mono-router active role is coder
    When the chase sweep pokes architect
    Then the resident pane is respawned with the project's architect launch script
    And no chase-wake-error naming swarmforge-architect is logged for that poke

  # BL-812 handoffd-cwd-wake-remap-05
  Scenario: a caller that sets no explicit project root still resolves through the git common dir
    Given a separate resident-invoked rotation process that sets no explicit project root
    And that process runs with its cwd inside the architect linked worktree of that project
    When it resolves the mono-router resident session
    Then it resolves to swarmforge-coder
