# mutation-stamp: sha256=a672df8a42a3e85170daf96926ad7619ab6612b3ee403310f249643f6fac0b5e
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-26T15:16:58.193203441Z","feature_name":"each Live Screen role tile owns its own activity status dot","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1160-live-screen-activity-dot-per-tile.feature","background_hash":"53cb4989c657d63600bb7e301c7f1736d3bb3233d5d3eab849111ee3ab912531","implementation_hash":"unknown","scenarios":[{"index":1,"name":"each tile dot uses the existing ok stale err palette","scenario_hash":"b6ffa57c42aba2ade89656443450546448d28efa947b4343b44c0fbfe6f8be56","mutation_count":9,"result":{"Total":9,"Killed":9,"Survived":0,"Errors":0},"tested_at":"2026-08-26T14:53:19.594014026Z"},{"index":0,"name":"the grid overview shows one activity dot per role tile","scenario_hash":"8bca612fec26579de7bfa52ea1153c6a810ce908b5a05657029c6035a9243764","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-26T14:52:46.023263345Z"}]}
# acceptance-mutation-manifest-end

Feature: each Live Screen role tile owns its own activity status dot

  # BL-1160: the Live Screen grid (BL-994) today drives one viewport-fixed
  # status dot (#dot) from whole-poll freshness. On the phone 2×4 grid that
  # single dot reads as belonging to whichever tile overlaps the corner —
  # not per-role health. Sibling to BL-1046 (held ticket on tile); this slice
  # is per-tile activity dots only.

  Background:
    Given the Live Screen is authenticated and showing the role grid
    And the grid renders one tile per role pane

  # BL-1160 per-tile-dot-count-01
  Scenario Outline: the grid overview shows one activity dot per role tile
    Given the grid is rendering "<count>" role panes
    When the role grid renders
    Then exactly "<count>" activity dots appear inside the grid tiles
    And each dot is positioned inside its owning tile

    Examples:
      | count |
      | 8     |
      | 4     |

  # BL-1160 dot-colours-match-palette-02
  Scenario Outline: each tile dot uses the existing ok stale err palette
    Given the "<role>" tile's freshness signal is "<signal>"
    When the role grid renders
    Then the "<role>" tile's activity dot has colour "<colour>"

    Examples:
      | role      | signal | colour |
      | coder     | ok     | green  |
      | architect | stale  | amber  |
      | qa        | err    | red    |

  # BL-1160 offline-not-misleading-green-03
  Scenario: a never-polled or offline pane does not show a misleading green dot
    Given the "documenter" tile has never been successfully polled
    When the role grid renders
    Then the "documenter" tile's activity dot is hidden or shows non-ok state
    And the grid does not read as all green tiles

  # BL-1160 markup-seam-per-pane-04
  Scenario: rendered grid markup includes one status indicator node per pane column
    Given the grid is rendering eight role panes
    When the role grid HTML is captured
    Then each pane column contains exactly one status indicator element

  # BL-1160 fullscreen-keeps-status-cue-05
  Scenario: fullscreen Expand keeps a clear status cue when the grid is hidden
    Given a role tile is expanded to fullscreen
    When the Expand view renders
    Then a visible activity status cue is still present
