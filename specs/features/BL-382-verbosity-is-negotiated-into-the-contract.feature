Feature: How much the agents say is negotiated into the contract

# BL-382: the human asked for "the verbosity of the agents" to be one more piece of negotiated
# config — "some users will like precise / long messages, others more concise messages". The
# contract is already the prompt-generating surface: BL-269's promptProposal.ts derives the
# target's projectPrompt and engineeringPrompt from the contract, so a negotiated verbosity flows
# into the generated role prompts for free. Settled with the human 2026-07-14: a closed enum
# (concise | normal | detailed), not free text — an explicit set validates, and per the
# engineering article an explicit KNOWN_VALUES lookup kills a mutated example value at the
# acceptance run instead of letting it survive to the hardener.

Background:
  Given a target repo has an agreed contract

# BL-382 verbosity-is-negotiated-into-the-contract-01
Scenario Outline: The agreed verbosity reaches the generated prompts
  Given the contract's agreed verbosity is <verbosity>
  When the target's prompts are generated
  Then the generated prompts tell the agents to be <verbosity>

  Examples:
    | verbosity |
    | concise   |
    | normal    |
    | detailed  |

# BL-382 verbosity-is-negotiated-into-the-contract-02
Scenario: A verbosity nobody offered is refused
  Given the contract states a verbosity that is not one of the offered levels
  When the target's prompts are generated
  Then the contract is refused as invalid

# BL-382 verbosity-is-negotiated-into-the-contract-03
Scenario: A contract that never mentioned verbosity still works
  Given the contract states no verbosity at all
  When the target's prompts are generated
  Then the generated prompts tell the agents to be normal

# BL-382 verbosity-is-negotiated-into-the-contract-04
Scenario: The human can change his mind about verbosity
  Given the contract's agreed verbosity is concise
  When the human negotiates the verbosity to detailed
  And the target's prompts are generated
  Then the generated prompts tell the agents to be detailed
