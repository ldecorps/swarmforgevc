# mutation-stamp: sha256=fa91a0a0b96cc38c8c1dbba6685c0cb4e98693f181872c31e6b63d04fa35bab4
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-27T10:03:35.879558700Z","feature_name":"Bubble talk mirror chunks long replies and fails loudly","feature_path":"/tmp/sf-hardender-bl726-3888499/specs/features/BL-718-bubble-talk-mirror-chunks-and-fails-loudly.feature","background_hash":"c6d1244a4ef3d04d938405129564a7d5cfcfda14e9ca89227cdf1172d4ebbc83","implementation_hash":"unknown","scenarios":[{"index":2,"name":"a mirror send that fails is surfaced, never swallowed","scenario_hash":"0aa2962a7c137a120268f6b59d735c27523a661730c6ab59bd12e2a9de301a91","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-27T10:03:35.879558700Z"}]}
# acceptance-mutation-manifest-end

Feature: Bubble talk mirror chunks long replies and fails loudly
  Every successful Let's Talk turn must leave a durable You / Bubble transcript
  in the standing Bubble topic. Today the mirror sends one un-chunked message
  and discards the result, so a long reply is dropped by Telegram and a failed
  send is invisible to the human.
  Source: human via Let's Talk 2026-07-30; BL-718.

  Background:
    Given the standing Bubble Telegram topic is bound
    And the bridge mirrors successful Let's Talk turns into that topic

  # BL-718 mirror-01
  Scenario: a short turn lands in the Bubble topic
    When a Let's Talk turn completes with a short reply
    Then the Bubble topic receives the transcript as You and Bubble text
    And the Cursor Remote topic does not receive that ordinary talk dump

  # BL-718 mirror-02
  Scenario: a long reply is chunked instead of dropped
    When a Let's Talk turn completes with a reply longer than one Telegram message
    Then the Bubble topic receives every part of the reply as ordered chunks
    And the mirror splits the text with the shared chunker the Cursor Remote path uses

  # BL-718 mirror-03
  Scenario Outline: a mirror send that fails is surfaced, never swallowed
    Given the Bubble topic mirror send fails with <failure>
    When the retry budget for that send is exhausted
    Then the mirror failure is surfaced to the operator
    And the turn is not recorded as having delivered a transcript

    Examples:
      | failure              |
      | a Telegram API error |
      | a network error      |

  # BL-718 mirror-04
  Scenario: choice polls keep working alongside the text mirror
    When a Let's Talk reply contains a choice poll
    Then the poll is still mirrored into the Bubble topic
    And the Bubble topic receives the transcript as You and Bubble text

  # BL-718 mirror-05
  Scenario: a mirror failure does not fail the phone turn
    Given the Bubble topic mirror send fails with a network error
    When the human's Let's Talk turn otherwise succeeded
    Then the human still receives the spoken reply
    And the mirror failure is reported on its own channel
