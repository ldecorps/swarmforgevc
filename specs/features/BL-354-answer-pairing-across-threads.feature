Feature: A human's answer reaches the question it answers, whatever thread he typed it in

# BL-354: the Operator asked a clarifying question in SUP-4 and the human answered "3" in SUP-2 —
# the thread he had been living in all day. `resolve-pending-answer` matches a pending question by
# THREAD ID, so the answer was never paired: the woken Operator saw a bare, contextless "3", the
# await state was never cleared, and the escalation sweep was primed to nag the human for an answer
# he had already given. A human answers where he is looking, not where our state machine filed the
# question.

Background:
  Given the Operator and the human are talking in Telegram topics

# BL-354 answer-pairing-across-threads-01
Scenario Outline: An answer is paired to its question and closes the await, whatever thread it arrives in
  Given the Operator has asked the human a question and is awaiting his answer
  When the human replies in "<reply-thread>"
  Then that reply is delivered to the Operator as the answer to the pending question
  And the Operator sees the question it answers alongside it
  And the Operator stops awaiting an answer
  And the human is never asked for that answer again

  Examples:
    | reply-thread       |
    | the asking thread  |
    | a different thread |

# BL-354 answer-pairing-across-threads-02
Scenario: A message arriving with no question pending is not treated as an answer
  Given the Operator has no question pending
  When the human sends a message
  Then that message is delivered to the Operator as an ordinary message with no question attached
