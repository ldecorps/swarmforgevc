Feature: BL-2015 A verification-debt category is discharged by a tool

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
  BL-2017): this file carries its scenario 01, the discharge.

  Background:
    Given a fixture git repository whose verification-debt ledger has rows in category "land-path-ownership" for tickets "BL-9001, BL-9002, BL-9003"
    And rows in category "other-check" for tickets "BL-9001, BL-9002"
    And the committed file "backlog/evidence/BL-9200-tool.md"

  # BL-2015 a-discharge-settles-every-outstanding-row-with-its-evidence-01
  Scenario: a discharge settles every outstanding row of the category with the tool's evidence
    When "coder" discharges category "land-path-ownership" with evidence "backlog/evidence/BL-9200-tool.md" on "2026-09-26"
    Then the settle command exits 0
    And the ledger committed at HEAD still carries all 3 "land-path-ownership" rows, each with discharged_at "2026-09-26" and discharged_evidence "backlog/evidence/BL-9200-tool.md"
    And the reader reports category "land-path-ownership" with count 0 and does not list it as unowned
    And the reader reports category "other-check" with count 2
