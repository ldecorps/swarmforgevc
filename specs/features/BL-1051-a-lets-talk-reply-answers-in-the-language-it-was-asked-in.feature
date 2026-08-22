Feature: A Let's Talk reply answers in the language it was asked in, and stays in it

  The phone plays one utterance through one TTS voice with one locale, so a
  reply that mixes languages is spoken half in the wrong accent. Today only
  the French prefix names a reply language, neither prefix forbids switching
  mid-reply, and a transcript that scores a tie falls to English - which is
  what a speech-to-text pass over spoken French routinely produces.

  Background:
    Given the Let's Talk speech language setting is "auto"

  # BL-1051 lets-talk-reply-language-01
  Scenario Outline: each voice-playback prefix names its own reply language
    When the turn resolves to "<language>"
    Then the agent prompt instructs a reply in "<language>"

    Examples:
      | language |
      | en       |
      | fr       |

  # BL-1051 lets-talk-reply-language-02
  Scenario Outline: each voice-playback prefix forbids switching language mid-reply
    When the turn resolves to "<language>"
    Then the agent prompt requires the whole reply to stay in "<language>"

    Examples:
      | language |
      | en       |
      | fr       |

  # BL-1051 lets-talk-reply-language-03
  Scenario Outline: the spoken-reply constraints survive in both prefixes
    When the turn resolves to "<language>"
    Then the agent prompt requires short plain sentences with no markdown, file paths or URLs

    Examples:
      | language |
      | en       |
      | fr       |

  # BL-1051 lets-talk-reply-language-04
  Scenario Outline: a confident transcript still decides its own turn
    Given the previous turn resolved to "<previous>"
    When the transcript "<transcript>" is spoken
    Then the turn resolves to "<language>"

    Examples:
      | previous | transcript                        | language |
      | en       | bonjour, comment ça va aujourd'hui | fr       |
      | fr       | hello, what is the status today    | en       |

  # BL-1051 lets-talk-reply-language-05
  Scenario Outline: a transcript with no evidence carries the previous turn's language
    Given the previous turn resolved to "<previous>"
    When the transcript "<transcript>" is spoken
    Then the turn resolves to "<language>"

    Examples:
      | previous | transcript          | language |
      | fr       | il va la bas demain | fr       |
      | en       | il va la bas demain | en       |
      | fr       |                     | fr       |

  # BL-1051 lets-talk-reply-language-06
  Scenario: with no previous turn to carry, a transcript with no evidence resolves to English
    Given no previous turn has resolved
    When the transcript "ok" is spoken
    Then the turn resolves to "en"

  # BL-1051 lets-talk-reply-language-07
  Scenario Outline: an explicit language setting overrides detection and history
    Given the Let's Talk speech language setting is changed to "<language>"
    And the previous turn resolved to "<previous>"
    When the transcript "bonjour, comment ça va" is spoken
    Then the turn resolves to "<language>"

    Examples:
      | language | previous |
      | en       | fr       |
      | fr       | en       |
