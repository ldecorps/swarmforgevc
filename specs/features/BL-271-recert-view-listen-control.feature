Feature: The phone app's recert view has a Listen (TTS) control

  Background:
    Given the phone app's recert view renders the recert batch

  # BL-271 recert-listen-01
  Scenario: the Listen control reads the displayed recert scenario aloud
    Given a scenario is shown for recertification
    When the user activates the Listen control in the recert view
    Then the spoken text is that scenario's name followed by its Gherkin text

  # BL-271 recert-listen-02
  Scenario: the recert Listen control's accessible label tracks its state
    Given a scenario is shown for recertification
    When the user starts and then stops listening in the recert view
    Then the control's accessible label is the localized Listen label when idle and the Stop label while speaking

  # BL-271 recert-listen-03
  Scenario: no Listen control when nothing needs recertification
    Given no scenario needs recertification
    When the recert view is rendered
    Then no Listen control is shown
