Feature: A pending question follows the human to the thread he is actually in

# BL-354: the Operator asked a clarifying question in SUP-4 and the human answered "3" in SUP-2 —
# the thread he had been living in all day. `resolve-pending-answer` matches a pending question by
# THREAD ID, so the answer was never paired: the woken Operator saw a bare, contextless "3", the
# await state was never cleared, and the escalation sweep was primed to nag the human for an answer
# he had already given. The human resolved the design fork (2026-07-14) in favour of OPTION C,
# SAME-THREAD-CLEARS: the thread gate stays — a cross-thread message is never CONSUMED as the
# answer — but it is never silently lost either. The question is re-posted into the thread the human
# IS in, and the await re-homes to follow him there, so his next reply lands where he is looking.
# The answer deadline keeps running from the ORIGINAL ask, so the episode stays bounded.

Background:
  Given the Operator and the human are talking in Telegram topics

# BL-354 answer-pairing-across-threads-01
Scenario: An answer typed in the asking thread is paired to its question and closes the await
  Given the Operator has asked the human a question in the asking thread
  When the human replies in the asking thread
  Then that reply is delivered to the Operator as the answer to the pending question
  And the Operator sees the question it answers alongside it
  And the Operator stops awaiting an answer

# BL-354 answer-pairing-across-threads-02
Scenario: A message in another thread is not consumed as the answer, and the question follows the human there
  Given the Operator has asked the human a question in the asking thread
  When the human writes in a different thread
  Then that message is delivered to the Operator as an ordinary message, with the pending question attached but no answer
  And the pending question is posted into the different thread
  And the Operator is still awaiting an answer

# BL-354 answer-pairing-across-threads-03
Scenario: The reply in the thread the question followed him to is the answer
  Given the Operator has asked the human a question in the asking thread
  And the human has written in a different thread, so the question was posted there
  When the human replies in that different thread
  Then that reply is delivered to the Operator as the answer to the pending question
  And the Operator stops awaiting an answer
  And the human is never asked for that answer again

# BL-354 answer-pairing-across-threads-04
Scenario: A message arriving with no question pending is not treated as an answer
  Given the Operator has no question pending
  When the human sends a message
  Then that message is delivered to the Operator as an ordinary message, with nothing attached

# BL-354 answer-pairing-across-threads-05
Scenario: An unanswered question is chased once, in the thread the human is actually in
  Given the Operator has asked the human a question in the asking thread
  And the human has written in a different thread, so the question was posted there
  When the answer deadline measured from the original question passes with no reply
  Then the human is reminded once, in the different thread
  And the Operator stops awaiting an answer
