# mutation-stamp: sha256=5d13c30dd4630c5bbfe68c90263695a267291b41699283623f8c183bb5cdba98
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-11T05:45:38.350809745Z","feature_name":"Onboarding negotiation generates the target repo's project.prompt and engineering.prompt from the survey","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-269-onboarding-generates-target-prompts.feature","background_hash":"e4801fd36bbaf97ad193f45abcda8a25e74ecd0d1989b80fb5e08c7820f265e3","implementation_hash":"unknown","scenarios":[{"index":2,"name":"the generated prompts follow the contract's agreement gate","scenario_hash":"61f78bd5566d9e6e4fe5b6e7704b0b82d1a4653153e21304f649af1cb21b117e","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-07-11T05:45:31.547414435Z"}]}
# acceptance-mutation-manifest-end

Feature: Onboarding negotiation generates the target repo's project.prompt and engineering.prompt from the survey

  Background:
    Given a repo survey of a target repo has gathered its facts (languages, layout, README, seed vision, initial backlog)

  # BL-269 onboarding-generated-prompts-01
  Scenario: the target project.prompt is generated populated from the survey, not a generic template
    When the onboarding negotiation proposes the target's prompt artifacts
    Then the proposed project.prompt content reflects the surveyed seed vision and product scope
    And it is not a generic placeholder template

  # BL-269 onboarding-generated-prompts-02
  Scenario: the target engineering.prompt is generated populated from the survey, not a generic template
    When the onboarding negotiation proposes the target's prompt artifacts
    Then the proposed engineering.prompt content reflects the surveyed languages and repo layout
    And it is not a generic placeholder template

  # BL-269 onboarding-generated-prompts-03
  Scenario Outline: the generated prompts follow the contract's agreement gate
    Given the proposed project.prompt and engineering.prompt are part of the onboarding contract
    When the contract agreement is <state>
    Then the generated prompts are <disposition> the target repo

    Examples:
      | state    | disposition            |
      | proposed | withheld from          |
      | pending  | withheld from          |
      | agreed   | released for commit to |
