Feature: "hey bubble" wakes the phone without the network

  Passive listening must cost nothing and tell nobody: the wake phrase is spotted
  entirely on the device, with no bridge turn and no cloud speech service, until
  the human actually says it. Only after that does anything leave the phone.

  Background:
    Given hands-free mode is on
    And the wake phrase is "hey bubble"

  # BL-845 offline-hey-bubble-wake-01
  Scenario Outline: the wake phrase never reaches the model as part of the request
    When the spotter reports a wake from "<heard>"
    Then the text submitted as the turn is "<submitted>"

    Examples:
      | heard                             | submitted            |
      | hey bubble what is the pipeline   | what is the pipeline |
      | hey bubble                        |                      |
      | hey bubble, stop the swarm        | stop the swarm       |

  # BL-845 offline-hey-bubble-wake-02
  Scenario Outline: while passive, nothing is asked of the bridge or the model
    Given the session is in "PassiveWake"
    When the phone hears "<heard>"
    Then no bridge request is made
    And no cloud speech service is called

    Examples:
      | heard                    |
      | what is the pipeline     |
      | the kettle is boiling    |
      | hey bumble               |

  # BL-845 offline-hey-bubble-wake-03
  Scenario: waking with no network still acknowledges locally
    Given the bridge cannot be reached
    When the spotter reports a wake from "hey bubble what is the pipeline"
    Then the wake is acknowledged locally
    And the failure reported for the turn names that the bridge could not be reached

  # BL-845 offline-hey-bubble-wake-04
  Scenario Outline: the bubble's colour says which kind of listening is happening
    When the session is in "<state>"
    Then the bubble is coloured "<colour>"

    Examples:
      | state        | colour     |
      | PassiveWake  | soft teal  |
      | ActiveListen | red        |
      | Thinking     | amber      |
      | Speaking     | blue       |
      | Paused       | gray       |
      | Error        | red        |
