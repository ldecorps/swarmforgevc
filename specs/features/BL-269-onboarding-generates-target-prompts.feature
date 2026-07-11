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
