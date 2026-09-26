Feature: BL-1783 A verification-debt category is settled by a tool or a reasoned waiver

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

  Background:
    Given a fixture git repository whose verification-debt ledger has rows in category "land-path-ownership" for tickets "BL-9001, BL-9002, BL-9003"
    And rows in category "other-check" for tickets "BL-9001, BL-9002"
    And the committed file "backlog/evidence/BL-9200-tool.md"

  # BL-1783 a-discharge-settles-every-outstanding-row-with-its-evidence-01
  Scenario: a discharge settles every outstanding row of the category with the tool's evidence
    When "coder" discharges category "land-path-ownership" with evidence "backlog/evidence/BL-9200-tool.md" on "2026-09-26"
    Then the settle command exits 0
    And the ledger committed at HEAD still carries all 3 "land-path-ownership" rows, each with discharged_at "2026-09-26" and discharged_evidence "backlog/evidence/BL-9200-tool.md"
    And the reader reports category "land-path-ownership" with count 0 and does not list it as unowned
    And the reader reports category "other-check" with count 2

  # BL-1783 a-waiver-settles-the-category-with-who-and-why-02
  Scenario: a waiver settles every outstanding row of the category with who waived it and why
    When "human" waives category "land-path-ownership" with reason "each case is a novel entanglement shape" on "2026-09-26"
    Then the settle command exits 0
    And the ledger committed at HEAD still carries all 3 "land-path-ownership" rows, each with waived_at "2026-09-26", waived_by "human" and that reason
    And the reader reports category "land-path-ownership" with count 0 and does not list it as unowned
    And the reader reports category "other-check" with count 2

  # BL-1783 a-settle-that-cannot-be-grounded-is-refused-03
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

  # BL-1783 a-row-recorded-after-a-settle-counts-again-from-one-04
  Scenario Outline: a hand verification recorded after a settle is new debt
    Given category "land-path-ownership" was settled by a <settle>
    When "QA" records category "land-path-ownership" for ticket "BL-9004"
    Then the reader reports category "land-path-ownership" with count 1
    And the 3 earlier "land-path-ownership" rows are still settled by the <settle>

    Examples:
      | settle    |
      | discharge |
      | waiver    |
