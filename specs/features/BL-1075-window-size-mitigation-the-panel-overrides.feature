# mutation-stamp: sha256=ba6e330f4d3a768178d9a0692e8b316853df6d2aa58b99250c27ecf72cdc0e42
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-22T22:25:28.444795382Z","feature_name":"BL-1075 the swarm applies only the tmux options it can keep","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1075-window-size-mitigation-the-panel-overrides.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":1,"name":"dropping the inert knob leaves the live one applied","scenario_hash":"1e2154ed3f93461993b48ae66260d42f460f307d3e6894bee3462ed5b0416d18","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-22T22:25:28.444795382Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1075 the swarm applies only the tmux options it can keep
  `harden_tmux_server` (swarmforge.sh) and `harden-server!`
  (control_plane_lib.bb) set `window-size largest` on the swarm's
  control-plane server as a soft mitigation for the tmux 3.4 resize.c
  segfault, and the ops how-to advertises it as one. It cannot take effect on
  any window the extension tiles: `resize-window -x/-y` "will automatically
  set window-size to manual in the window options" (tmux(1)), and a window
  option beats the server global. Sizing those windows is load-bearing - a
  headless tmux otherwise snaps every pane to 80x24 and a tile shows 24 lines
  - so the override is not going away.

  This slice makes the swarm's applied and documented mitigations match what
  actually holds, and nothing more. What to do on a control plane whose tmux
  is older than 3.7 - where the tiling panel arms WINDOW_SIZE_MANUAL per
  window and the version upgrade is the only real defence - is deliberately
  not decided here: it needs the server-version fact BL-1069 is adding, and
  is its own successor ticket.

  # BL-1075 inert-knob-not-applied-01
  Scenario: a knob the tiling panel overrides is not applied as a mitigation
    Given a live control-plane server on the swarm socket
    When the swarm hardens that server
    Then no window-size mitigation is applied at a scope the tiling panel overrides

  # BL-1075 live-knob-survives-02
  Scenario Outline: dropping the inert knob leaves the live one applied
    Given a live control-plane server on the swarm socket
    When the swarm reaches the "<path>" path
    Then focus-events is off on that server

    Examples:
      | path              |
      | shell launch      |
      | shell ensure      |
      | plane restore     |
      | plane already up  |

  # BL-1075 tiles-still-sized-03
  Scenario: per-role tile sizing survives the change
    Given the panel is tiling a coder window at 24 rows and a QA window at 60 rows
    When the panel applies its pane settings
    Then the coder window is 24 rows
    And the QA window is 60 rows

  # BL-1075 doc-drops-the-inert-mitigation-04
  Scenario: the ops how-to no longer offers the inert knob as a mitigation
    Given the tmux upgrade how-to
    When its soft-mitigation list is read
    Then it does not name a window-size option
