Feature: BL-1680 The local seat fixture pins the model it fakes
  BL-1384's acceptance handler wraps the real local-seat turn with only
  the endpoint faked, and the turn resolves its model id from the live
  process environment, so the feature is red on any session that exports
  SWARMFORGE_LOCAL_SEAT_MODEL to a model the fixture does not hold. This
  feature is that the fixture pins the model it fakes: BL-1384's feature
  is green whatever the host exports, and the turn asks the faked endpoint
  for the catalogue's own model.

  # BL-1680 the-feature-is-green-whatever-the-host-exports-01
  Scenario Outline: BL-1384's feature passes whatever SWARMFORGE_LOCAL_SEAT_MODEL the host exports
    Given a child process whose SWARMFORGE_LOCAL_SEAT_MODEL is <value>
    When it runs BL-1384's feature through the acceptance runner
    Then every scenario of that feature passes

    Examples:
      | value                |
      | unset                |
      | qwen2.5-coder:latest |

  # BL-1680 the-turn-asks-for-the-model-it-holds-02
  Scenario: the fixture turn asks the faked endpoint for the model its catalogue holds
    Given SWARMFORGE_LOCAL_SEAT_MODEL names a model the BL-1384 fixture catalogue does not hold
    When the BL-1384 fixture drains one forwarded message
    Then the completion is requested for the catalogue's own model
    And the seat's reply is posted in the local seat topic, not a does-not-hold refusal
