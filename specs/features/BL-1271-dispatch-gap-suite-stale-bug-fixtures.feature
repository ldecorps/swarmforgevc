Feature: The expedite picker's unit suite reflects the defect-only lane
  BL-1095 retired `type: bug` from the Article 3.2.4 expedite lane, leaving
  `expedited-types` as `#{"defect"}` only. Two assertions in the dispatch-gap
  unit suite still build their winning candidate as `type: bug` and expect it
  to be named, so the suite has been red on main since that retirement landed.

  The production predicate is correct and is not what this changes. The suite
  is the only gate wired for Babashka code, and its standing entry point
  refuses to run for an unrelated reason (BL-1239), so nothing has reported
  this red - each role that runs the file by hand pays a pass proving it
  pre-existing.

  # BL-1271 dispatch-gap-defect-only-01
  Scenario: The dispatch-gap unit suite passes
    Given the dispatch-gap unit suite on main
    When it is run
    Then every assertion in it passes

  # BL-1271 dispatch-gap-defect-only-02
  Scenario: A candidate of the retired ticket type is never named as expedited
    Given a paused candidate BL-A of type "bug" with severity critical and priority 5
    And a paused candidate BL-B of type "defect" with severity critical and priority 90
    When the expedite picker is asked for the top expedited candidate with no epic priority index
    Then it names BL-B
    And BL-A is not named

  # BL-1271 dispatch-gap-defect-only-03
  Scenario: Own priority breaks the tie within the expedited bucket
    Given a paused candidate BL-A of type "defect" with severity critical and priority 5
    And a paused candidate BL-B of type "defect" with severity critical and priority 90
    When the expedite picker is asked for the top expedited candidate with no epic priority index
    Then it names BL-A
