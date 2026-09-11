Feature: The live screen ticket strip can be collapsed to one line so the pane grid stays on a phone screen

  The top ticket strip of the live screen (the rotation-pack layout Bubble and
  the Telegram Mini App both render from the bridge) shows the working ticket's
  id, its full title and a role · model · claim-age line. Ticket titles now run
  to several hundred characters, so on a phone the strip alone fills the
  viewport and the pane grid under it is off-screen. The strip gets its own
  collapse control, distinct from the existing pane text-size control, which
  changes font size and not visibility.

  Background:
    Given the live screen is open in the grid view on a rotation layout
    And the working ticket's title runs to several hundred characters

  # BL-1542 live-screen-ticket-strip-collapse-01
  Scenario: The strip carries a collapse control of its own
    When the live screen first renders
    Then the ticket strip shows a collapse control
    And the collapse control is a different control from the pane text-size control
    And the ticket id, the full title and the role, model and claim-age line are all shown

  # BL-1542 live-screen-ticket-strip-collapse-02
  Scenario: Collapsing the strip clamps the title to one line and keeps the rest
    When the human taps the collapse control
    Then the ticket title is shown on a single ellipsized line
    And the ticket id and the role, model and claim-age line are still shown
    And the collapse control now offers to expand

  # BL-1542 live-screen-ticket-strip-collapse-03
  Scenario: Expanding the strip restores the full title
    Given the ticket strip is collapsed
    When the human taps the collapse control
    Then the full ticket title is shown again
    And the collapse control offers to collapse

  # BL-1542 live-screen-ticket-strip-collapse-04
  Scenario: A live refresh never changes the collapsed state
    Given the ticket strip is collapsed
    When the live screen refreshes its pane data twice
    Then the ticket strip is still collapsed
    And the claim age in the strip has been updated

  # BL-1542 live-screen-ticket-strip-collapse-05
  Scenario: The collapsed state is remembered through the bridge, not browser storage
    Given the human collapsed the strip on an earlier visit
    When the live screen loads again
    Then the ticket strip renders collapsed
    And no browser storage was written

  # BL-1542 live-screen-ticket-strip-collapse-06
  Scenario: When no ticket is working the control goes with the strip
    When the pane data carries no working ticket
    Then the ticket strip is hidden
    And no collapse control is shown on its own
