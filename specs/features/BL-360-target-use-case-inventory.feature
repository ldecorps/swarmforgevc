Feature: An onboarded target repo comes with an inventory of what it already does

# BL-360: the human pointed the swarm at a real target repo and asked for "the various use cases it
# supports now, so I can tweak or add new ones". The onboarding survey does not produce that, and he
# was wrongly told it would. Every fact the survey gathers — languages, layout, README, seed vision,
# initial backlog — answers "where are the edges of this codebase", the question you need in order to
# agree a MANDATE. None of them answers "what does this application actually DO, feature by feature",
# the question you need in order to CHANGE it. The contract is the vehicle; knowing what the thing
# already does is the goal.

Background:
  Given the swarm has been pointed at a target repo

# BL-360 target-use-case-inventory-01
Scenario: Onboarding a target repo produces an inventory of the use cases it supports
  When the swarm surveys the target repo
  Then it produces an inventory of the use cases the target's existing code supports

# BL-360 target-use-case-inventory-02
Scenario: The inventory is derived from the target's own code, not from its README alone
  When the swarm surveys the target repo
  Then each use case in the inventory names where in the target's code it is implemented

# BL-360 target-use-case-inventory-03
Scenario: The human sees the inventory before he has to decide on the contract
  Given the swarm has proposed a scope contract the human has not agreed to
  When the human asks what the target repo does
  Then the inventory is available to him
  And it is not withheld pending his agreement to the contract

# BL-360 target-use-case-inventory-04
Scenario: The inventory is the base for the human's next change request
  Given the inventory has been delivered to the human
  When he asks for a change to one of the use cases in it
  Then the change request can name that use case as its starting point

# BL-360 target-use-case-inventory-05
Scenario: A target whose code supports no discernible use case says so plainly
  Given the target repo has no discernible use cases
  When the swarm surveys the target repo
  Then the inventory says plainly that it found none, rather than inventing one
