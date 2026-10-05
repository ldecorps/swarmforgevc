Feature: BL-2016 A verification-debt category is waived, and a later hand check counts again

  BL-1782's ledger counts a category's outstanding hand verifications and
  reports it unowned at its threshold. A category leaves that state in one
  of two ways. Either a tool ships that makes the check mechanical, and the
  category is discharged with the tool's committed evidence (the
  hardening-debt ledger's discharged_at / discharged_evidence pattern), or
  whoever owns the question decides the check is not worth a tool and
  waives it with a stated reason. Settling never removes a row: the history
  of what was hand-checked stays readable next to how it was settled. A
  hand verification recorded after a settle is new debt and counts again
  from one, because the tool or the waiver did not cover it. Every scenario
  runs against a fixture git repository under mkdtemp (BL-1390).

  Moved verbatim from BL-1783 (split 2026-10-05 into BL-2015, BL-2016 and
  BL-2017): this file carries its scenarios 02 and 04, the waiver and the
  hand check recorded after a settle.

  Background:
    Given a fixture git repository whose verification-debt ledger has rows in category "land-path-ownership" for tickets "BL-9001, BL-9002, BL-9003"
    And rows in category "other-check" for tickets "BL-9001, BL-9002"
    And the committed file "backlog/evidence/BL-9200-tool.md"

  # BL-2016 a-waiver-settles-the-category-with-who-and-why-02
  Scenario: a waiver settles every outstanding row of the category with who waived it and why
    When "human" waives category "land-path-ownership" with reason "each case is a novel entanglement shape" on "2026-09-26"
    Then the settle command exits 0
    And the ledger committed at HEAD still carries all 3 "land-path-ownership" rows, each with waived_at "2026-09-26", waived_by "human" and that reason
    And the reader reports category "land-path-ownership" with count 0 and does not list it as unowned
    And the reader reports category "other-check" with count 2

  # BL-2016 a-row-recorded-after-a-settle-counts-again-from-one-04
  Scenario Outline: a hand verification recorded after a settle is new debt
    Given category "land-path-ownership" was settled by a <settle>
    When "QA" records category "land-path-ownership" for ticket "BL-9004"
    Then the reader reports category "land-path-ownership" with count 1
    And the 3 earlier "land-path-ownership" rows are still settled by the <settle>

    Examples:
      | settle    |
      | discharge |
      | waiver    |
