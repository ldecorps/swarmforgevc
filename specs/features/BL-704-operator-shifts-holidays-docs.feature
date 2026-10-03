Feature: BL-704 operator shifts, holidays, oncall, and docs
  Slice 3 of BL-698. Policy overlay and documenter deliverables.

  Background:
    Given BL-702 confirm foundations are in place
    And a principal-only Cursor Remote Telegram topic

  Scenario: Holiday quiet refuses pilot with Run anyway
    Given a holiday covering today is recorded
    When the principal sends "/pilot BL-698"
    Then the bridge refuses citing holiday quiet
    And the reply offers a Run anyway confirm
    When the principal confirms Run anyway
    Then the pilot path may proceed

  Scenario: Shift and holiday state round-trip under operator runtime
    When the principal sends "/holiday add 2099-01-01 2099-01-02 maintenance"
    And the principal sends "/holiday list"
    Then the list includes that range
    When the principal sends "/shift start evening"
    And the principal sends "/shift status"
    Then status reports the active shift
    And durable state is only under .swarmforge/operator/
