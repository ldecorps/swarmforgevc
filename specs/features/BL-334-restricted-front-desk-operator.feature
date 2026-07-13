Feature: The human is answered even while an Operator is busy

# BL-334: the single-Operator guard is keyed on a session name, and an interactive Operator sits
# in that slot indefinitely — it is instructed never to exit. So no Operator is ever spawned to
# read the front desk, and the human's messages queue unread for days. The fix the human chose:
# admit a SECOND Operator that serves the front desk and has no authority over the swarm, so the
# conflicting-actions risk the guard exists to prevent cannot arise.

Background:
  Given an Operator is mid-conversation with the human and will not exit

# BL-334 restricted-front-desk-operator-01
Scenario: A message sent while an Operator is mid-conversation is still answered
  When the human sends a message to the front desk
  Then the message is read
  And the human receives an answer

# BL-334 restricted-front-desk-operator-02
Scenario: The human's interactive session is not cut short to serve the front desk
  When the human sends a message to the front desk
  Then the Operator mid-conversation with the human is still running

# BL-334 restricted-front-desk-operator-03
Scenario Outline: The front-desk Operator cannot act on the swarm
  Given the front-desk Operator is running
  When it attempts to <swarm_action>
  Then the action does not happen
  And the swarm's state is unchanged

  Examples:
    | swarm_action              |
    | promote a backlog item    |
    | respawn an agent          |
    | merge to the main branch  |

# BL-334 restricted-front-desk-operator-04
Scenario: The front-desk Operator may do the one job it exists for
  Given the front-desk Operator is running
  When it replies to the human
  Then the reply reaches the human

# BL-334 restricted-front-desk-operator-05
Scenario: Only one unrestricted Operator can run at a time, as before
  Given an unrestricted Operator is running
  When another unrestricted Operator is requested
  Then it is not started

# BL-334 restricted-front-desk-operator-06
Scenario: Two concurrent Operators never process the same message twice
  Given the front-desk Operator is running
  And the human sends a message to the front desk
  When both Operators are given the chance to process it
  Then the message is processed exactly once

# BL-334 restricted-front-desk-operator-07
Scenario: Two concurrent Operators do not corrupt each other's reported state
  Given the front-desk Operator is running
  When the swarm's health is reported
  Then both Operators are reported
  And neither Operator's state has overwritten the other's
