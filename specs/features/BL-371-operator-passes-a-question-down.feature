Feature: A question the Operator cannot answer is passed down, never sat on

# BL-371: the human's requirement, verbatim (SUP-2, 2026-07-14): "Receiving a telegram message like
# this should immediately be picked up by operator, and either answered directly by it, or question
# should be passed down to the relevant agent." BL-369 buys the first half (the message is never
# lost) and the "answered directly" half already works. This ticket buys the half that does not
# exist at all today: passing it down.
#
# THE GAP, VERIFIED: operator_handoff.bb requires a pre-existing `--ticket BL-###`. So the Operator
# can route work about a ticket that already exists, and has NO path whatsoever for a raw question
# the human just asked that is not yet a ticket. Its only options today are to answer it or to sit
# on it — and sitting on it is what the human noticed and complained about.
#
# THE CHOSEN DESIGN (human, 2026-07-14, from three options): the Operator FILES IT AS A RAW INTAKE
# ITEM in the backlog root and TELLS THE HUMAN it has been filed. This is deliberately the channel
# that already exists — the backlog root is the human's own raw intake queue, and the specifier
# already drains it before all other work — so it needs no new routing authority and no new queue.
# It is also exactly what the Operator did BY HAND during the incident, which is the strongest
# evidence it is the right shape. Rejected: routing straight to an agent (routing is the
# coordinator's job per the constitution, not the Operator's) and a note to the coordinator (an
# extra hop that likely ends in the coordinator filing an intake anyway).
#
# THE FILED ITEM MUST BE COMMITTED, not merely written. Every pipeline role reads from its own
# isolated checkout; an uncommitted file in one working tree is invisible to the specifier and the
# question is lost a second time, in a new way (this is BL-314's lesson, and the intake that seeded
# THIS ticket was itself left sitting untracked).
#
# NOT IN SCOPE: deduplicating repeat questions (ask twice, file twice — the specifier drains and
# merges), and the Operator picking WHICH agent gets the work (that stays the coordinator's call).

Background:
  Given the human is talking to the Operator in a Telegram topic

# BL-371 operator-passes-a-question-down-01
Scenario: A question the Operator cannot answer is filed for the swarm
  Given the human asks the Operator something it cannot answer itself
  When the Operator handles the message
  Then the question is filed as a raw intake item in the backlog root
  And the human is told it has been filed

# BL-371 operator-passes-a-question-down-02
Scenario: The filed question actually reaches the specifier
  Given the Operator has filed a question as a raw intake item
  When the specifier drains the backlog root
  Then the filed question is there to be specced

# BL-371 operator-passes-a-question-down-03
Scenario: A question the Operator can answer is answered, not filed
  Given the human asks the Operator something it can answer itself
  When the Operator handles the message
  Then the Operator answers the human directly
  And no intake item is filed

# BL-371 operator-passes-a-question-down-04
Scenario: The human always learns which of the two happened
  Given the human asks the Operator a question
  When the Operator handles the message
  Then the human is told either the answer or where the question was filed
