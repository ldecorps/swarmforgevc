Feature: The onboarding scope contract is negotiated, not just proposed once

# BL-344: onboarding shipped a SINGLE-ROUND proposal — the swarm proposes, and the human's only
# recourse is to hand-edit the YAML. The back-and-forth was cut to "its own slice" and never
# ticketed. But BL-262's own word was NEGOTIABLE, and a single round is not a negotiation: when
# the first survey misreads an unfamiliar repo, the human ends up hand-writing the contract that
# onboarding existed to write for him. The likely way to build this wrong is a loop that runs,
# converges, and re-emits the same proposal — so the load-bearing test is that the NEXT proposal
# actually changes in the way the pushback asked for.

Background:
  Given the swarm has surveyed a target repository and proposed a scope contract

# BL-344 onboarding-negotiation-01
Scenario: The human can push back on a proposed contract in his own words
  When the human objects to the proposed contract
  Then the objection is accepted

# BL-344 onboarding-negotiation-02
Scenario: The next proposal reflects what the human pushed back on
  Given the human has objected to part of the proposed contract
  When the swarm proposes again
  Then the new proposal differs in the way the objection asked for

# BL-344 onboarding-negotiation-03
Scenario: Re-emitting the same proposal does not count as responding
  Given the human has objected to part of the proposed contract
  When the swarm proposes again
  Then the new proposal is not identical to the previous one

# BL-344 onboarding-negotiation-04
Scenario: The negotiation ends when the human approves
  Given the human has objected and the swarm has proposed again
  When the human approves the proposal
  Then the negotiation ends
  And the approved contract is the one that stands

# BL-344 onboarding-negotiation-05
Scenario: The negotiation ends after a bounded number of rounds, without approving
  Given the human keeps objecting
  When the round limit is reached
  Then the negotiation ends
  And no contract is approved

# BL-344 onboarding-negotiation-06
Scenario: Nothing is onboarded until the human has approved the contract
  Given the human has not approved any proposal
  When onboarding is attempted
  Then the target repository is not onboarded

# BL-344 onboarding-negotiation-07
Scenario: Each round records what was asked for and what changed
  Given the human has objected and the swarm has proposed again
  When the negotiation is reviewed
  Then each round records the objection and what changed in response
