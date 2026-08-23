Feature: An operator can choose a cursor seat on purpose

  With a launcher token (BL-1078) and a certified identity (BL-1079), a
  Cursor seat is reachable but not choosable: no pack line names cursor, no
  how-to says when to prefer it, and the whitelist rejection does not point
  at the Cursor path.

  This slice is the operator-facing half only. It does not replace any
  Claude seat and does not change /pilot.

  # BL-1080 cursor-pack-line-01
  Scenario: A pack line staffs a role with a certified cursor seat
    Given a certified Cursor identity
    And a pack window line naming cursor for a role
    When the operator launches the pack
    Then that role is staffed by a cursor seat

  # BL-1080 cursor-pack-line-02
  Scenario: Naming cursor without certification fails honestly
    Given a Cursor identity that is not certified
    And a pack window line naming cursor for a role
    When the operator launches the pack
    Then the launch is refused
    And the refusal points at the steward certification path

  # BL-1080 cursor-pack-line-03
  Scenario: The unsupported-agent error points at the cursor seat path
    Given a pack window line naming an agent the launcher does not support
    When the operator launches the pack
    Then the error points at the documented cursor seat path

  # BL-1080 cursor-pack-line-04
  Scenario: The how-to says when to prefer a cursor seat
    Given the operator documentation
    When an operator looks up how to choose a seat agent
    Then the documentation states when to prefer cursor over the alternatives
