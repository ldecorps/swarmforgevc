Feature: BL-1782 Hand verifications are recorded in a verification-debt ledger

  A role that checks or classifies something by hand, with no script to
  decide it, re-derives the check from scratch every time, and two sessions
  of the same role can do it differently. QA's BL-1711 land is the case
  that prompted this: QA grepped the branch for the paths that belonged to
  BL-1711 before it trusted the land step's keep/drop output. A prompt rule
  telling a role to watch for such checks still depends on an LLM
  remembering it. This register does the counting instead, in the idiom of
  backlog/standing-reds.tsv and backlog/hardening-debt-ledger.yaml. There
  is one row per hand verification, keyed by category and ticket. A reader
  counts a category's outstanding rows against a threshold, and a category
  at or over the threshold with no open ticket declaring it (the
  `verification_category:` field) is reported unowned. Settling a category
  (a tool shipped, or a reasoned waiver) is BL-1783. Throttling intake on
  an unowned category is BL-1784. Every scenario below except 06 runs
  against a fixture repository under mkdtemp (BL-1390); scenario 06 only
  reads the repository's own ledger.

  Background:
    Given a fixture git repository with backlog/paused, backlog/active and backlog/done and no verification-debt ledger

  # BL-1782 a-recorded-hand-verification-is-committed-and-counted-01
  Scenario: a recorded hand verification is committed and counted
    When "QA" records a hand verification in category "land-path-ownership" for ticket "BL-9001" described as "grepped the branch for the ticket's own paths" on "2026-09-26"
    Then the recorder exits 0
    And the ledger committed at HEAD carries one row for category "land-path-ownership" and ticket "BL-9001" naming role "QA", that description and date "2026-09-26"
    And the reader reports category "land-path-ownership" with count 1 and threshold 3

  # BL-1782 recording-the-same-category-and-ticket-again-adds-no-row-02
  Scenario: recording the same category and ticket again adds no row
    Given "QA" has recorded category "land-path-ownership" for ticket "BL-9001"
    When "architect" records a hand verification in category "land-path-ownership" for ticket "BL-9001" described as "checked the paths again"
    Then the recorder exits 0 and prints "VERIFICATION_DEBT_ALREADY_RECORDED land-path-ownership BL-9001"
    And the reader reports category "land-path-ownership" with count 1 and threshold 3

  # BL-1782 a-category-at-its-threshold-with-no-open-owner-is-unowned-03
  Scenario Outline: a category that reaches its threshold with no open owner is reported unowned
    Given swarmforge.conf sets verification_debt_threshold to "<conf>"
    And category "land-path-ownership" has rows for <prior> distinct tickets
    When a role records category "land-path-ownership" for one more ticket
    Then the reader reports category "land-path-ownership" with count <count> and threshold <threshold>
    And the reader <lists> "land-path-ownership" as unowned
    And the recorder <prints> "VERIFICATION_DEBT_UNOWNED land-path-ownership"

    Examples:
      | conf   | prior | count | threshold | lists         | prints         |
      | (none) | 1     | 2     | 3         | does not list | does not print |
      | (none) | 2     | 3     | 3         | lists         | prints         |
      | 2      | 1     | 2     | 2         | lists         | prints         |

  # BL-1782 only-an-open-tickets-declaration-owns-a-category-04
  # The fourth row names the category in a notes: line, not in the field:
  # prose never owns a category.
  Scenario Outline: only an open ticket's one-line declaration owns a category
    Given category "land-path-ownership" has rows for 3 distinct tickets
    And ticket "BL-9100" in "<folder>" carries the line "<line>"
    When the reader runs
    Then the reader <lists> "land-path-ownership" as unowned
    And the reader names owners "<owners>" for "land-path-ownership"

    Examples:
      | folder         | line                                                     | lists         | owners  |
      | backlog/paused | verification_category: land-path-ownership               | does not list | BL-9100 |
      | backlog/active | verification_category: [other-check, land-path-ownership] | does not list | BL-9100 |
      | backlog/done   | verification_category: land-path-ownership               | lists         | (none)  |
      | backlog/paused | notes: land-path-ownership needs a tool                  | lists         | (none)  |

  # BL-1782 a-malformed-record-is-refused-and-writes-nothing-05
  Scenario Outline: a malformed record is refused and writes nothing
    When "QA" records a hand verification in category "<category>" for ticket "<ticket>" described as "<description>"
    Then the recorder exits non-zero naming "<field>"
    And no verification-debt ledger commit exists at HEAD

    Examples:
      | category            | ticket  | description   | field       |
      | Land Path Ownership | BL-9001 | grepped paths | category    |
      | land-path-ownership | 9001    | grepped paths | ticket      |
      | land-path-ownership | BL-9001 |               | description |

  # BL-1782 the-repositorys-own-ledger-carries-the-seed-rows-06
  Scenario: the repository's own ledger carries the 2026-09-26 land path-ownership rows
    Given the repository's own verification-debt ledger
    Then it carries rows in category "land-path-ownership" for tickets "BL-1711, BL-1748, BL-1764, BL-1768"
