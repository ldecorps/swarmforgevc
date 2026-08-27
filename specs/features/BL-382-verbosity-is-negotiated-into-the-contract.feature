# mutation-stamp: sha256=a1760b3f00ac75e8352a6dc94dc10282b7addf5aa1a7d942a36ea67474b11b60
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-15T01:00:51.721590260Z","feature_name":"How much the agents say is negotiated into the contract","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-382-verbosity-is-negotiated-into-the-contract.feature","background_hash":"5119ea03d6073d4ddb9affc8647b3f5a9b0d25b13b714cf0ca5c8f9678d7ba52","implementation_hash":"unknown","scenarios":[{"index":0,"name":"The agreed verbosity reaches the generated prompts","scenario_hash":"12633801334c4a69592e9f11ac2573d6aafd32cb55a770f89ea378a74da02bc3","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-14T23:07:18.979579060Z"}]}
# acceptance-mutation-manifest-end

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
