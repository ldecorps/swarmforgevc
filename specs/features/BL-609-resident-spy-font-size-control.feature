Feature: The Resident Spy live screen offers a compact font size control in its header

  Background:
    Given the Resident Spy live screen is open on a pane

  # BL-609 resident-spy-font-size-control-01
  Scenario: The default pane text size is larger than the previous fixed size
    When the live screen first renders
    Then the pane output text renders at the new larger default size

  # BL-609 resident-spy-font-size-control-02
  Scenario: The increase and decrease controls change the pane text size
    When the human taps the increase control
    Then the pane output text renders one step larger
    When the human taps the decrease control
    Then the pane output text renders back at the previous size

  # BL-609 resident-spy-font-size-control-03
  Scenario Outline: The control refuses to move past its <bound> bound
    Given the pane text size is already at its <bound> bound
    When the human taps the <control> control
    Then the pane output text size is unchanged
    And the <control> control is shown as unavailable

    Examples:
      | bound   | control  |
      | minimum | decrease |
      | maximum | increase |

  # BL-609 resident-spy-font-size-control-04
  Scenario: The control is compact and does not displace the required header content
    When the live screen first renders
    Then the header still shows the ticket id and title, the role, the model, how long ago the pane entered its claim, and the resident badge
    And the size control renders smaller than the pane output text

  # BL-609 resident-spy-font-size-control-05
  Scenario: The chosen size governs the grid tiles and the fullscreen pane together
    Given several panes are shown in the grid view
    When the human increases the pane text size
    Then every grid tile renders at the increased size
    And the fullscreen pane renders at the increased size
    And a crowded grid still renders its tiles a fixed step smaller than the chosen size

  # BL-609 resident-spy-font-size-control-06
  Scenario: The chosen size is held without using browser storage
    When the human changes the pane text size
    Then no browser storage is written
