Feature: A standing Operator topic is the human's front door to the Operator

# BL-346: today the human can only reach the front-desk Operator through a per-issue SUP-# thread
# that must already exist, or by posting into the forum's default topic and landing on an invisible
# fallback subject. There is no NAMED, PINNED place that simply IS the Operator. This gives it one.
# The topic talks to the RESTRICTED operator (BL-334) — it is a front door, not a widening of what
# the Operator is allowed to do.
#
# No Background carries "the Operator topic exists": scenarios 01 and 07 assert its CREATION, so a
# Background asserting its existence would contradict the very thing they prove.

Background:
  Given a Telegram forum the swarm posts into
  And a restricted front-desk Operator that answers the human but cannot act on the swarm

# BL-346 standing-operator-topic-01
Scenario: The Operator topic exists without the human having to open an issue first
  Given no Operator topic has been created yet
  When the front desk starts up
  Then the Operator topic exists
  And it is bound to a stable reserved subject

# BL-346 standing-operator-topic-02
Scenario: A message in the Operator topic reaches the restricted Operator
  Given the Operator topic exists
  When the human posts a message in the Operator topic
  Then the restricted Operator receives it as a conversation message
  And it is not filed as a new support issue

# BL-346 standing-operator-topic-03
Scenario: The Operator answers in its own topic
  Given the Operator topic exists
  And the human has posted a message in the Operator topic
  When the Operator replies
  Then the reply appears in the Operator topic

# BL-346 standing-operator-topic-04
Scenario: The standing conversation accumulates
  Given the Operator topic exists
  And the human has already exchanged messages with the Operator in that topic
  When the human posts a follow-up that refers to the earlier exchange
  Then the Operator's reply is informed by the earlier messages in that topic

# BL-346 standing-operator-topic-05
Scenario: The Operator topic is never adopted as an ad-hoc support thread
  Given the Operator topic exists
  When the human posts a message in the Operator topic
  Then no new support issue is allocated for that topic

# BL-346 standing-operator-topic-06
Scenario: Starting up again does not create a second Operator topic
  Given the Operator topic exists
  When the front desk starts up again
  Then exactly one Operator topic exists

# BL-346 standing-operator-topic-07
Scenario: An Operator topic that was never recorded is created again
  Given the Operator topic is absent from the recorded topics
  When the front desk starts up
  Then the Operator topic exists
  And it is bound to the same stable reserved subject as before
