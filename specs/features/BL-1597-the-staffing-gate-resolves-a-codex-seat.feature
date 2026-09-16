Feature: BL-1597 The staffing gate resolves a codex seat

  The pack staffing gate resolves a window line's steward identity through
  an agent/model table or, for aider lines, the API base host. The table
  has no codex row, so every codex window line refuses
  seat-model-unresolved before any evidence is read, although
  openai/gpt-5.3-codex is certified and ranked on the coder and architect
  matrices; the shipped codex pack has only ever launched under the
  override hatch. This feature is that a codex line resolves to provider
  openai and is then decided on steward evidence like every other seat,
  that every line of the shipped codex pack resolves, and that an
  agent/model pair the table still does not name keeps failing closed.

  Background:
    Given a scratch steward root whose registry ranks openai/gpt-5.3-codex on coder and architect with both role gates recorded pass

  # BL-1597 the-staffing-gate-resolves-a-codex-seat-01
  Scenario Outline: a codex line resolves to the openai provider and is decided on evidence, while an unknown agent still fails closed
    Given the fixture registry <evidence>
    When the staffing gate decides the window line <line> with the override hatch unset
    Then the line resolves to <identity>
    And the decision is <decision>

    Examples:
      | line                                                   | evidence                                          | identity             | decision                    |
      | coder<TAB>coder<TAB>codex<TAB>--model gpt-5.3-codex     | is left as the Background built it                | openai/gpt-5.3-codex | pass                        |
      | architect<TAB>architect<TAB>codex<TAB>--model gpt-5.5  | is left as the Background built it                | openai/gpt-5.5       | refuse not-on-role-matrix   |
      | coder<TAB>coder<TAB>codex<TAB>--model gpt-5.3-codex     | has the coder matrix entry for that model removed | openai/gpt-5.3-codex | refuse not-on-role-matrix   |
      | coder<TAB>coder<TAB>unknown-agent<TAB>--model gpt-5.3-codex | is left as the Background built it            | no identity          | refuse seat-model-unresolved |

  # BL-1597 the-staffing-gate-resolves-a-codex-seat-02
  Scenario: every window line of the shipped codex pack resolves
    When the windows-file is derived from swarmforge/packs/codex-mono-router.conf by the launcher's field rules and the staffing gate decides it against the fixture root
    Then the derived windows-file holds as many lines as the pack has window lines, and at least 6
    And no line reads seat-model-unresolved
