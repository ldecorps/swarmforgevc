# mutation-stamp: sha256=dc2d8dd1d64d66f3f14a9e806ec6ed2ebb42d08cc73ba99ad06bbc50401b8274
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-13T08:15:38.322179958Z","feature_name":"The human is answered even while an Operator is busy","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-334-restricted-front-desk-operator.feature","background_hash":"80f1b212100c15e1d6e4e05dcfde47d51746eec9ad44a00811f83533c7817336","implementation_hash":"unknown","scenarios":[{"index":2,"name":"The front-desk Operator cannot act on the swarm","scenario_hash":"ded8cc8c1b8a902ff0a159b3c4f139788224f43ef90b0555695d1e375d65033d","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-13T08:15:32.172407101Z"}]}
# acceptance-mutation-manifest-end

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
