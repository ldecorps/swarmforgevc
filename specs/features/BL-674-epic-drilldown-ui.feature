Feature: Epic drill-down topic reprioritize UI

  Background:
    Given the epic reorder screen is rendered with epic "EA" holding live topics "A1,A2,A3"

  # BL-674 epic-drilldown-ui-01
  Scenario: Drilling into an epic lists its live topics in displayed order
    When the "EA" tile is drilled into
    Then the drill-down lists "A1,A2,A3" in priority ascending id ascending order
    And the Mini App pane header is present on the drill-down screen

  # BL-674 epic-drilldown-ui-02
  Scenario: A topic row with live dependencies carries a dependency marker
    Given topic "A3" depends on live topic "A1"
    When the "EA" tile is drilled into
    Then the "A3" row shows a dependency marker and the "A2" row shows none

  # BL-674 epic-drilldown-ui-03
  Scenario: Tapping make-top on a topic calls the topic route and re-renders the new order
    Given topic "A3" has no depends_on entries
    When the make-top button on row "A3" is tapped
    Then the topic make-top route is called with epic "EA" and topic "A3"
    And the list re-renders with "A3" first

  # BL-674 epic-drilldown-ui-04
  Scenario: A changed-false response renders its reason verbatim
    Given the topic make-top route answers changed false with reason "blocked by B2"
    When the make-top button on row "A3" is tapped
    Then the drill-down displays "blocked by B2"
    And the listed order is unchanged

  # BL-674 epic-drilldown-ui-05
  Scenario: Back navigation returns to the epic tiles
    Given the "EA" drill-down is open
    When back is tapped
    Then the epic tiles screen is displayed again
