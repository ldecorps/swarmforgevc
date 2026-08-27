Feature: A DUPLICATE-ID finding names the live-lifecycle copy and flags content divergence

  If the same ticket id exists at two paths, the backlog hygiene gate reports
  DUPLICATE-ID and lists the colliding paths. It says nothing about which copy is
  the live one, and nothing about whether the two files agree, so a resolver
  reading that line has to guess both facts. On 2026-08-27 a resolver guessed
  wrong in both directions at once: it kept the backlog/hold/ copies of seven
  tickets and deleted the backlog/active/ and backlog/paused/ originals, while
  asserting "confirmed identical content" for three files that in fact differed
  by four rounds of real bounce history.

  Backlog pools split in two. active/ and paused/ are LIVE: the coordinator
  promotes and routes out of them. hold/ and done/ are TERMINAL: nothing
  auto-promotes out of either. A collision spanning the two is always resolved
  by keeping the live copy.

  Background:
    Given an empty backlog corpus
    And ticket "BL-0001" exists at "backlog/active/BL-0001-x.yaml"

  # BL-1216 duplicate-id-live-copy-and-divergence-01
  Scenario: A collision between a live pool and a terminal pool names the live copy as the one to keep
    Given ticket "BL-0001" exists at "backlog/hold/BL-0001-x.yaml"
    When the backlog hygiene gate reports on "backlog/active/BL-0001-x.yaml"
    Then a DUPLICATE-ID finding is reported for "BL-0001"
    And the finding names "backlog/active/BL-0001-x.yaml" as the copy to keep
    And the finding does not name "backlog/hold/BL-0001-x.yaml" as the copy to keep

  # BL-1216 duplicate-id-live-copy-and-divergence-02
  Scenario: A collision confined to live pools recommends no copy, and still reports the violation
    Given ticket "BL-0001" exists at "backlog/paused/BL-0001-x.yaml"
    When the backlog hygiene gate reports on "backlog/active/BL-0001-x.yaml"
    Then a DUPLICATE-ID finding is reported for "BL-0001"
    And the finding names no copy to keep
    And the finding classifies every named path as "live"

  # BL-1216 duplicate-id-live-copy-and-divergence-03
  Scenario Outline: The finding states a content verdict, and an unreadable file is never called identical
    Given ticket "BL-0001" exists at "backlog/hold/BL-0001-x.yaml" whose contents are <contents>
    When the backlog hygiene gate reports on "backlog/active/BL-0001-x.yaml"
    Then the finding states the content verdict "<verdict>"

    Examples:
      | contents                        | verdict           |
      | byte-identical to the live copy | CONTENT IDENTICAL |
      | different from the live copy    | CONTENT DIFFERS   |
      | unreadable                      | CONTENT DIFFERS   |

  # BL-1216 duplicate-id-live-copy-and-divergence-04
  Scenario Outline: Every path named in the finding carries its pool and that pool's classification
    Given ticket "BL-0001" exists at "backlog/<pool>/BL-0001-x.yaml"
    When the backlog hygiene gate reports on "backlog/<pool>/BL-0001-x.yaml"
    Then the finding classifies "backlog/<pool>/BL-0001-x.yaml" as "<classification>"

    Examples:
      | pool   | classification |
      | paused | live           |
      | hold   | terminal       |
      | done   | terminal       |
