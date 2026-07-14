Feature: The front desk answers the human at the verbosity he agreed to

# BL-383: the other half of the human's verbosity ask, and the half he actually feels. BL-382 makes
# verbosity a term of the contract and feeds it to the AGENTS' generated prompts; but the messages
# the human personally reads are the front desk's replies to him on Telegram. Those are composed by
# `front-desk-reply-prompt` (swarmforge/scripts/operator_lib.bb:288) — a pure function over a map,
# whose result is written to the front-desk operator's prompt file on every wake. The front-desk
# operator is disposable and re-prompted per event, so a re-negotiated verbosity takes effect on the
# next reply with no restart — scenario 03 pins that.

Background:
  Given the human has an agreed contract with the swarm

# BL-383 the-front-desk-answers-at-the-agreed-verbosity-01
Scenario Outline: The front desk answers at the agreed level
  Given the agreed verbosity is <verbosity>
  When the human asks the front desk a question
  Then the front desk's reply follows the <verbosity> level

  Examples:
    | verbosity |
    | concise   |
    | normal    |
    | detailed  |

# BL-383 the-front-desk-answers-at-the-agreed-verbosity-02
Scenario: A contract that never mentioned verbosity is answered normally
  Given the contract states no verbosity at all
  When the human asks the front desk a question
  Then the front desk's reply follows the normal level

# BL-383 the-front-desk-answers-at-the-agreed-verbosity-03
Scenario: Changing the agreed verbosity changes the very next reply
  Given the agreed verbosity is detailed
  When the human negotiates the verbosity to concise
  And the human asks the front desk a question
  Then the front desk's reply follows the concise level
  And the swarm was never restarted
