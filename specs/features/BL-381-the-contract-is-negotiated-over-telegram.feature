Feature: The onboarding contract is negotiated with the human over Telegram

# BL-381: BL-344 already runs the contract's rounds — propose, take an objection, revise, record —
# but only over files and the CLI. The human asked for the back-and-forth to happen in the target's
# own Telegram group. The transport for a human's reply in a topic reaching the swarm already
# exists (BL-325's human-in-the-loop); the negotiation topic itself is minted by BL-380. This
# ticket is the WIRING that joins them, so the contract can actually be argued out on the phone.
#
# Scenario 02 is the point of the ticket, and it is an OUTLINE for exactly that reason: what must
# be proved is the LOOP, not the legs. A build that posts a proposal, takes one objection and
# stops is a form, not a negotiation — so the round count is the parameter, and two rounds must
# work as readily as one.

Background:
  Given the target repo has a contract negotiation topic
  And a contract has been proposed for the target

# BL-381 the-contract-is-negotiated-over-telegram-01
Scenario: The proposed contract is put in front of the human
  When the contract is proposed to the human
  Then the proposed contract appears in the target's negotiation topic

# BL-381 the-contract-is-negotiated-over-telegram-02
Scenario Outline: The negotiation runs for as many rounds as the human needs
  Given the human has objected <rounds> times in the negotiation topic
  When the swarm has answered every objection
  Then the negotiation topic carries <rounds> revised contracts

  Examples:
    | rounds |
    | 1      |
    | 2      |

# BL-381 the-contract-is-negotiated-over-telegram-03
Scenario: Every round survives a restart
  Given the human has objected once in the negotiation topic
  When the swarm has answered every objection
  Then the target's negotiation record carries both the objection and the revision

# BL-381 the-contract-is-negotiated-over-telegram-04
Scenario: The human's agreement in the topic settles the contract
  Given the human has agreed to the contract in the negotiation topic
  When the swarm reads the human's answer
  Then the target's contract is marked as agreed
