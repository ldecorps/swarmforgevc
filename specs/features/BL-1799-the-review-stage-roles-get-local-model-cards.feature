Feature: BL-1799 The review-stage roles get local-model cards

  BL-1798 gives a local-model seat a compact card, the shared loop card
  plus its role's own card, and a role with no card still composes the
  full generic text: 60,808 characters for the cleaner, 68,858 for the
  architect, 231,796 for the hardender and 64,737 for the documenter,
  measured 2026-09-29. local-model-mono-router.conf staffs all four on a
  7B local model. This slice writes their cards, so each composes within
  the same 8192-character budget and still names the stage it forwards to.

  # BL-1799 a-review-stage-role-composes-its-card-01
  Scenario Outline: a local-model review-stage role composes its own card within 8192 characters
    When the prompt factory composes the "<role>" prompt for the "local-model" agent
    Then the composed prompt is at most 8192 characters
    And it names ready_for_next.sh, done_with_current.sh and swarm_handoff.sh
    And it names swarmforge/roles/<role>.prompt and swarmforge/constitution.prompt as where the full text lives
    And it names "<next>" as the role it forwards to

    Examples:
      | role       | next       |
      | cleaner    | architect  |
      | architect  | hardender  |
      | hardender  | documenter |
      | documenter | QA         |
