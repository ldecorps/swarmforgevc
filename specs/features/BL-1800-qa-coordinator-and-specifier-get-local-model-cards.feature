Feature: BL-1800 QA, coordinator and specifier get local-model cards

  The last of the local-model cards. After BL-1798 and BL-1799 a
  local-model QA, coordinator or specifier still composes the full generic
  text: 107,712, 108,940 and 120,442 characters, measured 2026-09-29.
  local-model-mono-router.conf staffs all three on a 7B local model, its
  coordinator through coordinator_agent. Each gets a card within the
  8192-character budget. A duty the constitution reserves for a hard-tier
  seat is refused on the card, never attempted.

  # BL-1800 a-gatekeeping-role-composes-its-card-01
  Scenario Outline: a local-model QA, coordinator or specifier composes its own card within 8192 characters
    When the prompt factory composes the "<role>" prompt for the "local-model" agent
    Then the composed prompt is at most 8192 characters
    And it names ready_for_next.sh, done_with_current.sh and swarm_handoff.sh
    And it names swarmforge/roles/<role>.prompt and swarmforge/constitution.prompt as where the full text lives

    Examples:
      | role        |
      | QA          |
      | coordinator |
      | specifier   |

  # BL-1800 a-local-specifier-refuses-deprecator-judgment-02
  Scenario: a local-model specifier's card refuses deprecator judgment and escalates it
    When the prompt factory composes the "specifier" prompt for the "local-model" agent
    Then it tells the seat to refuse deprecator adjudication and escalate it to a hard-tier seat or the human

  # BL-1800 every-role-the-all-local-pack-staffs-composes-a-card-03
  Scenario: every role the all-local pack staffs composes a compact card
    When the prompt factory composes every role local-model-mono-router.conf staffs for the "local-model" agent
    Then each composed prompt names the "local-compact" bootstrap text style and is at most 8192 characters
    And the census is exactly 8 roles and includes "coordinator"
