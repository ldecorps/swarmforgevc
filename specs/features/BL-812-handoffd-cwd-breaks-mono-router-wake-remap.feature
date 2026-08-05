Feature: BL-812 handoffd cwd breaks mono-router wake remap
  Mono-router chase must remap dormant-role wakes to the resident (or rotate)
  even when handoffd's process cwd is not the project root.

  # BL-812 handoffd-cwd-wake-remap-01
  Scenario: wake-session remaps a dormant role when cwd is outside the project
    Given handoffd's argv project-root is a live mono-router checkout
    And only the resident and coordinator tmux sessions exist
    And the process cwd is a directory that is not that project root
    When wake-session is resolved for the architect session name
    Then the wake target is the resident session
    And the wake target is not swarmforge-architect

  # BL-812 handoffd-cwd-wake-remap-02
  Scenario: chase rotates onto a dormant role with actionable mail under foreign cwd
    Given handoffd runs with cwd outside the project root
    And the architect inbox/new holds an actionable git_handoff
    And the mono-router active role is coder
    When the chase sweep pokes architect
    Then the resident is rotated to architect
    Or a wake is injected into the resident session
    And no chase-wake-error names swarmforge-architect for that poke

  # BL-812 handoffd-cwd-wake-remap-03
  Scenario: wake-session remaps identically from project cwd and foreign cwd
    Given the same mono-router checkout and resident session
    When wake-session is resolved for hardender from the project cwd
    And wake-session is resolved for hardender from a foreign cwd
    Then both resolutions return the same resident session name
