Feature: BL-1822 The morning briefing carries the recruiter's model scout table
  The recruiter's score table (BL-1821) lives on the host. The documenter
  authors the morning briefing and must not invent or re-rank numbers,
  so a tool renders the Model scout section from the table and the
  documenter pastes it. When nothing has been scouted since the previous
  briefing, the section is one line saying so. How the section reads on a
  phone is the Art Director's to sign off.

  # BL-1822 fresh-table-renders-rows-01
  Scenario: a table updated since the previous briefing renders its rows, best first
    Given a score table with 3 specifier rows updated after the previous briefing
    When the Model scout section is rendered
    Then it lists the 3 rows by passed count, highest first, each naming the model, its passed count out of the total and whether it is the incumbent
    And it ends with the table's recommend line

  # BL-1822 empty-states-02
  Scenario Outline: the section is one line when <state>
    Given <state>
    When the Model scout section is rendered
    Then the section is the single line "<line>"

    Examples:
      | state                                                     | line                                               |
      | the score table was last updated before the previous briefing | Model scout: no new scout since the previous briefing. |
      | no score table exists                                     | Model scout: no scout has run yet.                 |
