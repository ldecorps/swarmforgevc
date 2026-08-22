Feature: the hands-free session - wake once, talk, then go quiet

  Hands-free Bubble today is turn-oriented: every exchange needs a gesture, and
  nothing decides when a conversation is over. This is the state machine that
  makes it feel like a domestic assistant - passive until woken, conversational
  while active, and quiet again after the human stops talking - without ever
  leaving the mic hot forever.

  Background:
    Given hands-free mode is on
    And the silence window is 10 seconds
    And the session is in "PassiveWake"

  # BL-844 hands-free-session-state-machine-01
  Scenario: while passive, speech that is not the wake signal reaches no model
    When the human says "what is the pipeline doing"
    Then no turn is submitted
    And the session is in "PassiveWake"

  # BL-844 hands-free-session-state-machine-02
  Scenario Outline: only a wake signal or an explicit gesture opens a session
    When the session receives a "<signal>"
    Then the session is in "<resulting state>"

    Examples:
      | signal            | resulting state |
      | wake signal       | ActiveListen    |
      | push-to-talk tap  | ActiveListen    |
      | playback finished | PassiveWake     |

  # BL-844 hands-free-session-state-machine-03
  Scenario: inside an open session a follow-up needs no wake signal
    Given the session is in "ActiveListen"
    When the human says "and what about the backlog"
    Then a turn is submitted
    And the session is in "Thinking"

  # BL-844 hands-free-session-state-machine-04
  Scenario Outline: after an answer, silence ends the session and speech extends it
    Given the session has just finished speaking an answer
    When <what happens> after 6 seconds
    And a further 6 seconds pass
    Then the session is in "<resulting state>"

    Examples:
      | what happens                        | resulting state |
      | nothing is heard                    | PassiveWake     |
      | the human asks another question     | Thinking        |

  # BL-844 hands-free-session-state-machine-05
  Scenario Outline: a polite closer does not hold the session open by itself
    Given the session has just finished speaking an answer
    When the human says "<utterance>"
    And the silence window elapses with nothing further heard
    Then the session is in "PassiveWake"
    And the number of turns submitted for that utterance is <turns>

    Examples:
      | utterance | turns |
      | thank you | 0     |
      | thanks    | 0     |

  # BL-844 hands-free-session-state-machine-06
  Scenario Outline: a hard end phrase goes quiet without waiting out the window
    Given the session has just finished speaking an answer
    When the human says "<utterance>"
    Then the session is in "PassiveWake"
    And the silence window is not being waited out

    Examples:
      | utterance |
      | stop      |
      | I'm done  |
      | goodbye   |

  # BL-844 hands-free-session-state-machine-07
  Scenario: a barge-in while speaking reopens the mic rather than ending the session
    Given the session is in "Speaking"
    When the session receives a barge-in signal
    Then the session is in "ActiveListen"

  # BL-844 hands-free-session-state-machine-08
  Scenario: with hands-free off, silence never drops the session to passive
    Given hands-free mode is off
    And the session is in "ActiveListen"
    When the silence window elapses with nothing further heard
    Then the session is still in "ActiveListen"
