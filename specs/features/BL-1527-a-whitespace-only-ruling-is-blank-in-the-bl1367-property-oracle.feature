Feature: BL-1527 A whitespace-only ruling is blank in the bl1367 property oracle

  extension/test/bl1367ApprovalCarriesItsRuling.property.test.js quantifies
  over rulings drawn by fc.string, which can draw a whitespace-only string.
  classifyApprovalRulingRequirement and recordApprovalReply both trim before
  deciding whether a ruling was given ("Blank is not an answer", BL-1367),
  so on a ticket posing no choice a whitespace-only ruling is a plain
  approval. The test's P3 oracle decides on the untrimmed string and
  expects unknown-option, so the file fails on the seeds that draw one.
  This feature is that the oracle agrees with the classifier's definition
  of blank, and that the blank draw is constructed and reach-asserted
  rather than hoped for or filtered away.

  # BL-1527 whitespace-only-ruling-is-blank-01
  Scenario: the property file is green on the tree as it stands
    When extension/test/bl1367ApprovalCarriesItsRuling.property.test.js runs alone under the properties config
    Then every test in it passes

  # BL-1527 whitespace-only-ruling-is-blank-02
  Scenario Outline: the oracle and the classifier agree on a ticket posing no choice
    Given a ticket declaring no ruling options
    When the oracle and the classifier are each asked about the ruling <ruling>
    Then both answer <kind>

    Examples:
      | ruling              | kind           |
      | a single space      | ok             |
      | a single tab        | ok             |
      | three spaces        | ok             |
      | absent              | ok             |
      | the empty string    | ok             |
      | a free-text answer  | unknown-option |

  # BL-1527 whitespace-only-ruling-is-blank-03
  Scenario: a whitespace-only ruling on a ticket posing no choice is a plain approval
    Given a ticket pending human approval that declares no ruling options
    When the human approves it through a surface that sent a whitespace-only ruling
    Then the ticket records approval
    And the ticket records no human ruling

  # BL-1527 whitespace-only-ruling-is-blank-04
  Scenario: the blank draw is constructed and its reach is asserted
    When extension/test/bl1367ApprovalCarriesItsRuling.property.test.js runs alone under the properties config
    Then the run reports having generated a whitespace-only ruling on a ticket posing no choice
    And the reach floor at the end of the first test names that outcome
