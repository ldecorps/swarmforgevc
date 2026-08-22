Feature: The question sheet lets the human answer on Bubble, or open Let's Talk to discuss it further
  BL-837 makes the collapsed bubble shout that something needs a pick. This slice
  is what the human finds when they open it: a remote page, named by the UI bundle
  manifest and hosted in the pager beside the native Talk page, showing who asked,
  what they asked, the asker's own options, and one extra choice — discuss it
  further. Tapping an option answers through the same channel a Telegram tap uses.
  Discussing further is deliberately NOT an answer: it opens Let's Talk primed with
  the question, and the question stays outstanding until a real answer is submitted.
  Source: backlog/INTAKE-bubble-clarification-blink-answer-sheet.md.

  Background:
    Given Bubble is paired to a reachable bridge and the question page is open

  # BL-838 question-sheet-01
  Scenario: the sheet shows the question as the asker posed it
    Given the specifier has an optioned clarifying question pending
    Then the page names the specifier as the asker and shows the question text
    And it offers each of the asker's own options
    And it offers discuss it further as an extra choice

  # BL-838 question-sheet-02
  Scenario Outline: an open question still gets a first-class answer path
    Given the specifier has an <question-kind> clarifying question pending
    Then the page offers a free-text reply

    Examples:
      | question-kind |
      | optioned      |
      | open          |

  # BL-838 question-sheet-03
  Scenario Outline: submitting an answer clears the question and the attention pulse
    Given the specifier has an optioned clarifying question pending
    When the human submits <answer-form>
    Then the answer is delivered to the specifier through the canonical answer channel
    And the question is no longer pending
    And the collapsed bubble stops pulsing

    Examples:
      | answer-form       |
      | a listed option   |
      | a free-text reply |

  # BL-838 question-sheet-04
  Scenario: discuss it further opens Let's Talk without answering
    Given the specifier has an optioned clarifying question pending
    When the human chooses discuss it further
    Then the native Let's Talk surface opens with that question in context
    And the question is still pending
    And the collapsed bubble is still pulsing

  # BL-838 question-sheet-05
  Scenario: a question that changed under the human is never answered by mistake
    Given the page is showing the specifier's question
    And that question is superseded before the human taps
    When the human submits a listed option
    Then the submission is reported as refused with the reason
    And the page re-renders showing the question that is pending now

  # BL-838 question-sheet-06
  Scenario Outline: the page always says what is going on
    Given <situation>
    Then the page states <what-it-says>
    And the page is never blank

    Examples:
      | situation                       | what-it-says                        |
      | no clarification is waiting     | that nothing needs an answer        |
      | the bridge cannot be reached    | that it cannot reach the bridge     |
