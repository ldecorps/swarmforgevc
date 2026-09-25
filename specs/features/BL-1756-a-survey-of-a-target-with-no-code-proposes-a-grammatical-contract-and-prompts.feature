Feature: BL-1756 A survey of a target with no code proposes a grammatical contract and prompts

  Onboarding proposes a target's CONTRACT.md, project.prompt and
  engineering.prompt from a survey of its existing code. A greenfield
  target has none, and today the templates slot the fallback phrase "the
  surveyed" into sentences that expect a language list. The result reads
  "Work within the existing the surveyed codebase", and the engineering
  prompt's Tech Stack is the lone line "the surveyed". Found live
  onboarding gpu-bargain-hunter on 2026-09-25. USE-CASES.md already
  handles the same empty case in plain words.

  # BL-1756 a-target-with-no-code-is-said-plainly-01
  Scenario: a survey with no languages proposes a contract and prompts that say plainly there is no code yet
    Given survey facts with no languages and a full-sentence layout summary
    When the onboarding contract and prompts are proposed from the survey
    Then no line of the contract or either prompt contains "existing the surveyed"
    And the contract scope says the target has no code yet
    And the engineering prompt's Tech Stack section says no stack is chosen yet

  # BL-1756 surveyed-code-keeps-todays-wording-02
  Scenario Outline: a survey of existing code proposes exactly today's wording
    Given survey facts with languages "<languages>" and the layout summary "<layout>"
    When the onboarding contract and prompts are proposed from the survey
    Then the contract scope reads "Work within the existing <languages> codebase (layout: <layout>)."
    And the engineering prompt's Tech Stack section is "<languages>"

    Examples:
      | languages  | layout                                 |
      | TypeScript | extension/ holds the VS Code extension |
      | Python, Go | src/ and cmd/                          |
