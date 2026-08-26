Feature: The bridge exposes a waiting clarification and accepts its answer through the canonical path
  A role raises a clarifying question with role_ask.bb, which writes the per-role
  pending record. Today exactly one surface can read that record and answer it:
  the Telegram front desk. Bubble — the always-on phone surface — has no way to
  learn a question is waiting and no way to answer one, because the bridge serves
  no route for either. This slice adds that pair of routes, and the hard rule it
  must not break is that answering over the bridge applies the SAME delivery the
  Telegram tap already applies. A second answer store would be a second decision
  system, which is exactly what the question-attention-path epic forbids.
  Source: backlog/INTAKE-bubble-clarification-blink-answer-sheet.md.

  Background:
    Given the bridge is running and the caller is authorized

  # BL-836 pending-clarification-bridge-01
  Scenario: nothing is waiting
    Given no role has a clarifying question pending
    When the pending clarification is read over the bridge
    Then the answer is that nothing is pending

  # BL-836 pending-clarification-bridge-02
  Scenario Outline: a waiting question is readable, whatever affordance it offers
    Given the specifier has an <question-kind> clarifying question pending
    When the pending clarification is read over the bridge
    Then the reply names the asking role and the question text
    And the reply offers <answer-affordance>

    Examples:
      | question-kind | answer-affordance                    |
      | optioned      | the asker's own options, and free text |
      | open          | free text only                        |

  # BL-836 pending-clarification-bridge-03
  Scenario: when several roles are waiting, the longest-waiting one is offered
    Given the specifier raised a clarifying question before the coordinator did
    And both are still pending
    When the pending clarification is read over the bridge
    Then the reply names the specifier's question

  # BL-836 pending-clarification-bridge-04
  Scenario Outline: an answer is delivered by the same path a Telegram answer takes
    Given the specifier has an optioned clarifying question pending
    When <answer-form> is submitted over the bridge for that question
    Then the answer is delivered to the specifier as the Telegram tap would deliver it
    And the pending record for the specifier is cleared
    And no second pending-question or answer store is written

    Examples:
      | answer-form           |
      | a listed option       |
      | a free-text reply     |

  # BL-836 pending-clarification-bridge-05
  Scenario Outline: an answer that does not match the pending question is refused
    Given the specifier's clarifying question has been <what-happened>
    When an answer for the earlier question is submitted over the bridge
    Then the submission is refused with the reason stated
    And nothing is delivered to the specifier

    Examples:
      | what-happened                    |
      | answered already                 |
      | superseded by a newer question   |
      | cancelled                        |

  # BL-836 pending-clarification-bridge-06
  Scenario: answering does not depend on the role's pane being live
    Given the specifier has an open clarifying question pending
    And the specifier's pane is dormant
    When a free-text reply is submitted over the bridge for that question
    Then the answer is queued for the specifier's next rotation
    And the pending record for the specifier is cleared
