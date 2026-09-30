Feature: BL-1835 The closing ceremony's briefing note reaches the documenter through the ceremony's own pause

  Since e9f91d6746 (2026-09-21) an active control pause holds every parcel
  in a role's inbox, so a seat finishes only the ticket it already holds
  and never works its queue (human directive 2026-09-21). The closing
  ceremony sets that pause as its first step, until its own hard deadline,
  and then sends the documenter "produce the morning briefing for <day>".
  The pause held that note too. On 2026-09-30 the documenter asked for its
  next task at 07:12:20Z and was told "SKIPPED pause-hold" for it. The
  pause lifted at 07:45:00Z, the moment the ceremony wrote the headless
  dump and stopped the swarm, and the documenter read the note after the
  restart at 08:00Z, when the day already had a briefing. Every morning
  briefing from 2026-09-23 on was the headless dump. The briefing
  instruction to the documenter is now served while a pause is active;
  every other parcel stays held as before.

  Background:
    Given a fixture project root whose control pause is active

  # BL-1835 the-briefing-instruction-is-served-during-a-pause-01
  Scenario: the documenter is served the briefing instruction while its other parcel stays held
    Given the documenter's inbox holds an ordinary note queued before the pause
    And the documenter's inbox holds the note "produce the morning briefing for 2026-10-01"
    When the documenter asks for its next task
    Then it is served the note "produce the morning briefing for 2026-10-01"
    And the ordinary note is reported "SKIPPED pause-hold" and is still in the documenter's inbox

  # BL-1835 every-other-parcel-stays-held-02
  Scenario Outline: every other parcel stays held while the pause is active
    Given the <role>'s inbox holds <parcel>
    When the <role> asks for its next task
    Then it is served nothing
    And that parcel is reported "SKIPPED pause-hold" and is still in the <role>'s inbox

    Examples:
      | role       | parcel                                                   |
      | documenter | a git_handoff for BL-9001                                |
      | coder      | the note "produce the morning briefing for 2026-10-01"   |
      | QA         | the note "land documenter briefing 0123456789"           |

  # BL-1835 both-triggers-instructions-pass-the-pause-03
  Scenario Outline: the instruction each briefing trigger sends is one the pause lets through
    Given the documenter's inbox holds the briefing instruction for 2026-10-01 as <trigger> composes it
    When the documenter asks for its next task
    Then it is served that note

    Examples:
      | trigger                    |
      | the closing ceremony       |
      | the fixed-morning fallback |
