Feature: BL-1737 Ask the specifier by voice or text from the intake form

  The human wants interactive help while drafting: "A push to talk and a
  tts talking back to me would be great, a bit like we have with bubble,
  but the agent would be the specifier." The form gains an Ask panel. It
  runs Let's Talk's own turn loop and controls (tap to talk, tap to send,
  optional hands-free, hold music, mute) plus a text box, and it is routed
  to the draft's own specifier session (BL-1735). Replies are short and
  spoken, with the full text on screen. Any change the specifier wants
  arrives as an ordinary suggestion, and the conversation goes into the
  submitted intake.

  Background:
    Given a draft is open in the form

  # BL-1737 a-spoken-question-gets-a-spoken-answer-01
  Scenario: a spoken question gets a spoken answer about my draft
    When I tap talk, ask "is there already a ticket for this?" and tap again
    Then the specifier's answer is spoken
    And its text is shown under the draft

  # BL-1737 typing-works-as-well-as-talking-02
  Scenario: a typed question is answered the same way
    When I type the question "is there already a ticket for this?"
    Then the specifier's answer is spoken
    And its text is shown under the draft

  # BL-1737 a-proposed-change-waits-for-me-03
  Scenario: a change the specifier proposes while we talk waits for me
    Given the specifier proposes a new scenario while we talk
    Then the proposal is listed as a suggestion with Accept and Reject
    And my draft is unchanged until I accept it

  # BL-1737 verify-knows-what-we-discussed-04
  Scenario: Verify runs in the same session as the conversation
    Given I talked with the specifier about my draft
    When I press Verify
    Then the Verify runs in the same specifier session as that conversation

  # BL-1737 the-transcript-travels-with-the-intake-05
  Scenario: the conversation goes into the submitted intake
    Given I talked with the specifier about my draft
    When I submit the draft
    Then the INTAKE file holds the conversation transcript
