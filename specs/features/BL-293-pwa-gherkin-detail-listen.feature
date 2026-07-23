Feature: Listen to the full Gherkin spec from the PWA ticket detail (reuse the BL-266 control)

  Background:
    Given the static PWA's Gherkin full-detail view for a ticket

  # BL-293 gherkin-listen-01
  Scenario: the Listen control reads the full spec aloud and stops on a second activation
    Given a ticket detail with a description and acceptance scenarios
    When the Listen control is activated
    Then the description and every scenario are read aloud on-device
    And activating it again stops the reading

  # BL-293 gherkin-listen-02
  Scenario: where speech is unavailable a listen-unavailable note shows instead
    Given a device without speech synthesis
    When the ticket detail renders
    Then a listen-unavailable note shows in place of the control

  # BL-293 gherkin-listen-03
  Scenario: the Listen toggle is keyboard-operable with a state-tracking label
    Given a rendered Listen toggle
    When it moves between listening and stopped
    Then its aria-label tracks the current state
    And it is operable by keyboard
