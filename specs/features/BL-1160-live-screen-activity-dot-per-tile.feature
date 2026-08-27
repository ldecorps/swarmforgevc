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
