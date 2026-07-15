# mutation-stamp: sha256=da06cf0bf7df067bab5243027a3af3e02a499995076dde142c5e9c25e73f6154
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-15T03:15:27.881781385Z","feature_name":"The onboarding contract is negotiated with the human over Telegram","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-381-the-contract-is-negotiated-over-telegram.feature","background_hash":"5128087c51b85b9c682513c1d3d1eb55c0b0abcf4c96f2afe0f1ce8ab8cb0e28","implementation_hash":"unknown","scenarios":[{"index":1,"name":"The negotiation runs for as many rounds as the human needs","scenario_hash":"96caae0d100980c5265eb9f3b7e4d81ee5fe9628220033ced30a6d9d3f5e020b","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-15T03:15:27.881781385Z"}]}
# acceptance-mutation-manifest-end

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
