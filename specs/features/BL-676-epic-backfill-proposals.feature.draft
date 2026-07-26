Feature: Epic backfill proposal report

  Background:
    Given a fixture backlog with epic roster "console,reliability" and done tickets nested in milestone subfolders

  # BL-676 epic-backfill-proposals-01
  Scenario: A ticket whose milestone maps cleanly to one epic gets a milestone-map proposal
    Given done ticket "BL-010" has no epic field and milestone "M3" maps only to epic "console"
    When the proposal report is generated
    Then the "BL-010" row proposes "console" with tier "milestone-map" and evidence naming "M3"

  # BL-676 epic-backfill-proposals-02
  Scenario: A ticket matching a roster epic's title keywords gets a roster-match proposal
    Given done ticket "BL-011" has no epic field and its title matches roster epic "reliability"
    When the proposal report is generated
    Then the "BL-011" row proposes "reliability" with tier "roster-match" and evidence showing the match

  # BL-676 epic-backfill-proposals-03
  Scenario: A ticket with no clear signal lands in needs-judgment with an empty proposal cell
    Given done ticket "BL-012" has no epic field and matches no milestone map or roster epic
    When the proposal report is generated
    Then the "BL-012" row has tier "needs-judgment" and an empty proposal cell

  # BL-676 epic-backfill-proposals-04
  Scenario: A ticket predating the epic system is proposed the pre-epic-era sentinel
    Given done ticket "BL-002" has no epic field and its milestone predates the earliest roster epic
    When the proposal report is generated
    Then the "BL-002" row proposes "pre-epic-era" with evidence citing its milestone age

  # BL-676 epic-backfill-proposals-05
  Scenario: Already-tagged done tickets are excluded from the report
    Given done ticket "BL-020" already carries a non-empty epic field
    When the proposal report is generated
    Then the report has no "BL-020" row

  # BL-676 epic-backfill-proposals-06
  Scenario: Generating the report modifies no backlog file
    When the proposal report is generated
    Then only the report file is created and every backlog file is byte-identical to before

  # BL-676 epic-backfill-proposals-07
  Scenario: The report covers every untagged done ticket exactly once, including nested folders
    Given the fixture has untagged done tickets in two different milestone subfolders
    When the proposal report is generated
    Then each untagged done ticket appears in exactly one row
