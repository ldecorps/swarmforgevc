Feature: deprecator freshness gate's retired-token extractor names the retired item, not a co-occurring word

  # BL-1193 (epic BL-1172, depends_on BL-1173, BL-1190 discovery incident
  # 2026-08-27): deprecate-check.js's loadRetiredTokens verb regex
  # (`\b([a-z][a-z0-9_-]{2,})\b.*\bRETIRED\b`) captures the FIRST word on a
  # docs line that precedes a RETIRED marker, not the word the marker
  # actually names. docs/how-to/BL-1095-...md's table row "Mint hygiene
  # (`backlog_hygiene_lib.bb`) | `type: bug` -> `RETIRED-TICKET-TYPE ... use
  # type: defect`" names `type: bug` as retired, but the extractor captured
  # "Mint" instead — falsely holding BL-1190, whose description uses "Mint"
  # only in the unrelated sense of "Mint durability gate" (a ticket-minting
  # gate BL-1190 proposes to build).

  Background:
    Given the Article 3.6 deprecator freshness gate is in force
    And a docs line whose RETIRED marker names "type: bug" and which also contains the unrelated earlier word "Mint"

  # BL-1193 retired-token-anchored-to-marker-01
  Scenario Outline: only the word the RETIRED marker actually names holds the gate
    Given a paused ticket whose depends_on are all done and whose description names "<ticket_text>"
    When the deprecator freshness check runs for that ticket
    Then the decision is "<decision>"

    Examples:
      | ticket_text | decision |
      | Mint        | allow    |
      | type: bug   | hold     |

  # BL-1193 combined-mention-reason-is-precise-02
  Scenario: a description naming both the unrelated word and the genuine retired item still names only the genuine one
    Given a paused ticket whose depends_on are all done and whose description names both "Mint" and "type: bug"
    When the deprecator freshness check runs for that ticket
    Then the decision is hold
    And the reason names "type: bug"
    And the reason does not name "Mint"
