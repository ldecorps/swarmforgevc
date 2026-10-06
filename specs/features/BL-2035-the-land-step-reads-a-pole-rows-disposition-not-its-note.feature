Feature: BL-2035 The land step reads a pole row's disposition, not its note

  The land step retires every register row the landing ticket owns
  (BL-1631), except an accepted pole. It recognises that row by the words
  "accepted pole" anywhere in its line, written before the pole register
  had a disposition column. BL-1629 added the column: the fifth field is
  `owned` or `accepted` when it is exactly one of those, and a row without
  it reads as owned. The budget check reads the column, so an accepted row
  whose note lacks the words is retired by its rationale ticket's land, and
  an owned row whose note uses them is never retired. The land step now
  reads the disposition with the budget check's own rule.

  # BL-2035 retire-reads-the-disposition-01
  Scenario Outline: the land step keeps a row the landing ticket owns exactly when its disposition is accepted
    Given a pole register row owned by the landing ticket in the <shape> form whose note <note>
    When the land step lists the rows it retires
    Then that row is <verdict>

    Examples:
      | shape    | note                              | verdict  |
      | accepted | never mentions an accepted pole   | kept     |
      | owned    | says it is not an accepted pole   | retired  |
      | legacy   | says it is an accepted pole       | retired  |

  # BL-2035 both-readers-agree-02
  Scenario: the land step and the budget check agree on every row of a register in both forms
    Given a pole register holding owned, accepted and legacy rows owned by the landing ticket
    When the land step lists the rows it retires
    And the budget check reads each row's disposition
    Then the land step keeps exactly the rows the budget check reads as accepted
