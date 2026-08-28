Feature: An answer delivered to a role frees that role's question slot
  role_ask.bb allows one pending clarifying question per role, recorded at
  .swarmforge/operator/role-awaiting/<role>.json. The marker is cleared only
  by deliverRoleAnswer, once it has confirmed the answer pairs with the
  question - and on the dormant-pane leg nothing runs it. When the answer is
  short enough to ride inline in the note the role receives, the role gets its
  answer, acts on it, and is never told to consume anything, so the marker
  stays set and the role's NEXT question is refused as already-pending on a
  question that was answered long ago. A tapped option label is almost always
  short enough, which makes this the common path rather than an edge case.

  The pairing itself is not in question here and must not be weakened: an
  answer that does not match the pending question, or that never arrived,
  still leaves the slot shut.

  Background:
    Given role "specifier" has a pending clarifying question

  # BL-1244 delivered-answer-frees-slot-01
  Scenario: an answer short enough to ride inline still frees the slot
    When the human answers "Exempt git-ignored dirs (tmp/) by construction"
    And the answer is delivered to the role
    Then role "specifier" raising a new question is accepted

  # BL-1244 delivered-answer-frees-slot-02
  Scenario: freeing the slot does not cost the role its answer
    When the human answers "Exempt git-ignored dirs (tmp/) by construction"
    And the answer is delivered to the role
    Then the role receives the answer "Exempt git-ignored dirs (tmp/) by construction"

  # BL-1244 delivered-answer-frees-slot-03
  Scenario: an answer recorded for a different question does not free the slot
    When an answer recorded against a different question is delivered to the role
    Then role "specifier" raising a new question is refused as already-pending

  # BL-1244 delivered-answer-frees-slot-04
  Scenario: an unanswered question keeps the slot shut
    When no answer has been recorded for the role
    Then role "specifier" raising a new question is refused as already-pending
