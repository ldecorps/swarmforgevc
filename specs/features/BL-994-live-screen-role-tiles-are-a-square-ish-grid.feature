Feature: Live Screen role tiles are a square-ish grid, not thin strips

  The Live Screen is the phone-viewable window onto the running pack. With
  four workers visible it laid the panes out as a flex row with a percentage
  flex-basis, so they shrank horizontally into thin vertical strips, and the
  tile headers used word-break: break-word, so a role name stacked one letter
  per line. The surface was unreadable on a phone.

  A grid tile carries the role name and an Expand control and nothing else;
  the metadata and transcript belong to the fullscreen Expand view.

  Background:
    Given the Live Screen is rendered for the running pack

  # BL-994 role-tiles-square-ish-grid-01
  Scenario Outline: Tiles are laid out in columns that never crush a pane
    Given <panes> worker panes are visible
    When the Live Screen is viewed at <viewport>
    Then the tiles are laid out in <columns> columns

    Examples:
      | panes | viewport       | columns |
      | 4     | phone portrait | 2       |
      | 1     | phone portrait | 1       |
      | 6     | phone portrait | 2       |
      | 6     | 700px wide     | 3       |
      | 8     | 700px wide     | 4       |

  # BL-994 role-name-reads-as-a-word-02
  Scenario: A role name is never stacked one letter per line
    Given 4 worker panes are visible
    When the Live Screen is viewed at phone portrait
    Then each tile shows its role name as unbroken text

  # BL-994 grid-tile-carries-role-name-and-expand-only-03
  Scenario: A grid tile carries the role name and an Expand control and nothing else
    Given 4 worker panes are visible
    When the Live Screen is viewed at phone portrait
    Then each tile shows its role name and an Expand control
    And no tile shows the pane transcript

  # BL-994 expand-fullscreen-is-unchanged-04
  Scenario: Expand still opens the full metadata and transcript
    Given 4 worker panes are visible
    When a tile's Expand control is opened
    Then the fullscreen view shows that pane's full metadata and transcript
