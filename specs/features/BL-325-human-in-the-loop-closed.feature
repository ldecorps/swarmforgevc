Feature: A human asked to approve something can see the question, answer it, and unblock the agent

# BL-325: the human-in-the-loop is decorative — the swarm raises a gate, discards the
# question text, records the human's reply where nothing reads it, and proceeds without
# them. Ship as ONE loop: any single leg fixed alone still leaves the loop open.
# Prove the loop end to end, not the parts.

Background:
  Given a gated role is blocked on a backlog item awaiting human approval
  And that backlog item has its own Telegram topic

# BL-325 human-in-the-loop-closed-01
Scenario: The approval request states what is being asked
  When the human is notified that the item needs approval
  Then the notification states the question being asked
  And it is not merely the ticket id

# BL-325 human-in-the-loop-closed-02
Scenario: A reply typed into the item's topic reaches a consumer that acts on it
  Given the human types an answer into that backlog item's topic
  When the reply is routed
  Then it is delivered to the Operator as context for that backlog item
  And a consumer acts on it
  And it is not merely recorded where nothing reads it

# BL-325 human-in-the-loop-closed-03
Scenario: The human's answer reaches the gated role and unblocks it
  Given the human has answered the approval question in the item's topic
  When the answer is relayed to the gated role
  Then the gated role is unblocked
  And the answer is relayed through the existing approval relay rather than a second one

# BL-325 human-in-the-loop-closed-04
Scenario: The Operator can post into a backlog item's topic through a supported path
  When the Operator posts a message to that backlog item's topic
  Then the message appears in that topic
  And it is sent through a supported swarm path, not a direct Telegram API call

# BL-325 human-in-the-loop-closed-05
Scenario: The whole loop closes without the human being bypassed
  Given a gated role raises an approval question the human has not yet answered
  When the human reads the question in the topic and answers it there
  Then the gated role receives that answer and proceeds
  And the item does not complete before the human's answer arrives

# BL-325 human-in-the-loop-closed-06
Scenario: Support threads are unaffected
  Given the human sends a message in a SUP support thread
  When the message is routed
  Then it behaves exactly as it did before this feature
