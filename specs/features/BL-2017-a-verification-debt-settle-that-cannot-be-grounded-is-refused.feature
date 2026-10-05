Feature: BL-2017 A verification-debt settle that cannot be grounded is refused

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
  BL-2017): this file carries its scenario 03, the refusals.

  Background:
    Given a fixture git repository whose verification-debt ledger has rows in category "land-path-ownership" for tickets "BL-9001, BL-9002, BL-9003"
    And rows in category "other-check" for tickets "BL-9001, BL-9002"
    And the committed file "backlog/evidence/BL-9200-tool.md"

  # BL-2017 a-settle-that-cannot-be-grounded-is-refused-03
  # The step splits <arguments> on spaces; the token BLANK stands for an
  # empty argument (a --reason of "").
  Scenario Outline: a settle that cannot be grounded is refused and writes nothing
    When a settle command runs with "<arguments>"
    Then the settle command exits non-zero naming "<reason>"
    And the verification-debt ledger at HEAD is unchanged

    Examples:
      | arguments                                                                        | reason             |
      | --discharge land-path-ownership --by coder                                       | --evidence         |
      | --discharge land-path-ownership --by coder --evidence backlog/evidence/absent.md | evidence file      |
      | --discharge no-such-check --by coder --evidence backlog/evidence/BL-9200-tool.md | no outstanding row |
      | --waive land-path-ownership --by human --reason BLANK                            | --reason           |
      | --waive land-path-ownership --reason novel-shapes                                | --by               |
