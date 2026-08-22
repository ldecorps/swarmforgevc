Feature: A Telegram button carries a URL Telegram will accept

  The tunnel notifier attaches an "Update Bubble pairing" button to both the
  topic message and the private DM. Both builders passed the bare
  swarmforge-bubble custom-scheme URI, which the Bot API rejects outright, so
  every rotation of the tunnel URL produced a 400 and left the user with no
  working way to re-pair.

  The correct value was already in the same struct: BL-788 built the bridge's
  own pre-auth pair page and an https URL reaching it. What was missing was
  the wiring, and a test that would have noticed. Both existing tests asserted
  the button equalled the deep link, so they stayed green while every live
  call failed.

  These scenarios pin the property the Bot API enforces - the scheme - rather
  than the identifier the code happens to pass.

  Background:
    Given a live tunnel URL carrying a pairing token

  # BL-1060 pairing-button-scheme-01
  Scenario Outline: The pairing button uses a scheme Telegram accepts
    When the "<surface>" keyboard is built
    Then its pairing button URL uses the https scheme
    And that URL addresses the bridge pair page
    And it carries the token from the live tunnel URL

    Examples:
      | surface     |
      | topic       |
      | private DM  |

  # BL-1060 pairing-button-scheme-02
  Scenario Outline: No button in either keyboard carries a scheme Telegram rejects
    When the "<surface>" keyboard is built
    Then every button URL in it uses an accepted scheme

    Examples:
      | surface     |
      | topic       |
      | private DM  |

  # BL-1060 pairing-button-scheme-03
  Scenario: A custom-scheme button URL is refused before it reaches Telegram
    Given a keyboard built with the bare app-scheme pairing URI
    When that keyboard is checked against the accepted schemes
    Then the check fails
    And it names the offending scheme

  # BL-1060 pairing-button-scheme-04
  Scenario: The notifier reaches both surfaces against a bot that enforces the scheme
    Given a Telegram bot that rejects a button URL on any other scheme
    When the tunnel notifier runs for a rotated tunnel URL
    Then the topic message is edited
    And the private direct message is sent

  # BL-1060 pairing-button-scheme-05
  Scenario Outline: Every other button each surface carries is unaffected
    When the "<surface>" keyboard is built
    Then it still offers the "<app>" button

    Examples:
      | surface    | app          |
      | topic      | Console      |
      | private DM | Console      |
      | private DM | Resident Spy |
