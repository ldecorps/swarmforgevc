Feature: A Cursor identity is steward-certified before production routing

  BL-712's non-negotiable gate: an uncertified Cursor must never be silently
  routable on a production pack. Today no Cursor identity exists in the
  steward registry in a form matching how the seat bills and identifies
  itself, so the gate has nothing to check against.

  This slice puts Cursor through the existing registry lifecycle - candidate,
  compliance battery, evidence, certified - and records the Cursor-specific
  residuals. The launcher token is BL-1078; operator-facing pack lines are
  BL-1080.

  # BL-1079 cursor-steward-certify-01
  Scenario: A Cursor identity enters the registry as a candidate
    Given no Cursor identity in the steward registry
    When the steward registers Cursor
    Then the registry holds a Cursor identity in candidate standing
    And the identity records how the seat bills and identifies itself

  # BL-1079 cursor-steward-certify-02
  Scenario: Certification requires a landed evidence artifact
    Given a Cursor identity in candidate standing
    When the steward runs the compliance battery
    Then an evidence artifact is landed for that run
    And the artifact records the Cursor-specific residuals

  # BL-1079 cursor-steward-certify-03
  Scenario Outline: Production routing follows the identity's standing
    Given a Cursor identity in <standing> standing
    When a production pack asks the model factory to route to Cursor
    Then routing is <outcome>

    Examples:
      | standing  | outcome  |
      | candidate | refused  |
      | certified | allowed  |

  # BL-1079 cursor-steward-certify-04
  Scenario: A refusal to route says what is missing
    Given a Cursor identity that has not completed certification
    When a production pack asks the model factory to route to Cursor
    Then the refusal names the certification step that has not run
