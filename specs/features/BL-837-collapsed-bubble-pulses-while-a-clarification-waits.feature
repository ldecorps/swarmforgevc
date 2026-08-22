Feature: The collapsed Bubble pulses while a clarification is waiting, and stops when it is not
  The collapsed overlay circle today shows the talk phase and nothing else, so a
  question that blocks a pipeline role is invisible unless the human happens to be
  watching Telegram. This slice gives that circle an attention state: while a
  clarification is genuinely outstanding it pulses an attention colour, and it
  stops the moment the question is answered, cancelled or superseded. The human
  called out that prior attempts at this class of feature did not stick, so the
  reliability of "pulses only while waiting is real" is the behaviour under test —
  not the animation. The collapsed bubble is thin-shell native by BL-824's locked
  decision 2, which is why this slice is native and its sheet (BL-838) is not.
  Source: backlog/INTAKE-bubble-clarification-blink-answer-sheet.md.

  Background:
    Given Bubble is paired to a reachable bridge and the collapsed overlay is showing

  # BL-837 clarification-pulse-01
  Scenario: a question that starts waiting starts the pulse
    Given no clarification is waiting
    And the bubble is idle
    When a role raises a clarifying question
    Then the collapsed bubble pulses the attention colour within one poll interval

  # BL-837 clarification-pulse-02
  Scenario Outline: the pulse stops as soon as the question stops waiting
    Given a clarification is waiting
    And the collapsed bubble is pulsing
    When the question is <ending>
    Then the collapsed bubble stops pulsing within one poll interval
    And it returns to its ordinary idle appearance

    Examples:
      | ending      |
      | answered    |
      | cancelled   |
      | superseded  |

  # BL-837 clarification-pulse-03
  Scenario Outline: a live talk turn keeps its own phase colour
    Given a clarification is waiting
    When the bubble is <phase>
    Then the collapsed bubble shows the <phase> colour, not the attention pulse
    And the attention pulse resumes once the bubble is idle again

    Examples:
      | phase     |
      | recording |
      | thinking  |
      | speaking  |

  # BL-837 clarification-pulse-04
  Scenario: the attention colour is distinct from every existing phase colour
    Given a clarification is waiting
    And the bubble is idle
    Then the attention colour differs from every talk-phase colour the bubble already uses

  # BL-837 clarification-pulse-05
  Scenario: motion is optional, attention is not
    Given the device has animations disabled
    And a clarification is waiting
    And the bubble is idle
    Then the collapsed bubble shows the attention colour steadily instead of pulsing

  # BL-837 clarification-pulse-06
  Scenario Outline: the pulse follows the last state actually observed, never a guess
    Given the collapsed bubble is <before> because that is the last observed state
    When the bridge is unreachable and a poll fails
    Then the collapsed bubble is still <before>

    Examples:
      | before      |
      | pulsing     |
      | not pulsing |

  # BL-837 clarification-pulse-07
  Scenario: an unpaired Bubble never claims a question is waiting
    Given Bubble has never been paired
    Then the collapsed bubble does not pulse
    And no pending-clarification poll is made
