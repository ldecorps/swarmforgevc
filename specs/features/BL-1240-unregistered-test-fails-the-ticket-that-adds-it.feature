Feature: An unregistered test file fails the ticket that adds it
  The suite manifest gate checks the whole tree at suite-run time. That is the
  wrong moment: whoever adds a test file without a manifest row is not
  stopped, and the refusal lands later on whoever next runs the full suite -
  in practice QA, on an unrelated parcel, holding a list of other tickets'
  omissions it cannot reasonably author rows for.

  Measured over the five days after the gate landed, files accumulated
  unregistered at roughly six a day and the suite went from runnable to
  refusing outright, with 39 names in the failure.

  The check must fail the parcel that introduces the omission, while it is
  still one row and still the author's own file.

  Background:
    Given a parcel that is ready to move to the next stage

  # BL-1240 unregistered-test-fails-author-01
  Scenario: A parcel adding an unregistered test file is refused
    Given the parcel adds a file under the test directory
    And that file has no row in the suite manifest
    When the parcel is forwarded
    Then the forward is refused
    And the refusal names the file and the row it needs

  # BL-1240 unregistered-test-fails-author-02
  Scenario: A parcel that registered its test file is forwarded
    Given the parcel adds a file under the test directory
    And that file has a row in the suite manifest
    When the parcel is forwarded
    Then the forward proceeds

  # BL-1240 unregistered-test-fails-author-03
  Scenario: A parcel that adds no test file is unaffected
    Given the parcel adds no file under the test directory
    And test files added by earlier parcels are unregistered
    When the parcel is forwarded
    Then the forward proceeds

  # BL-1240 unregistered-test-fails-author-04
  Scenario: A manifest row that registers nothing is an error, not a silent no-op
    Given a manifest row whose first column names no file under the test directory
    When the manifest is validated
    Then the validation fails and names that row
