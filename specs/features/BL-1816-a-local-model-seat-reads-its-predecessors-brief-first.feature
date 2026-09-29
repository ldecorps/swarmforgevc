Feature: BL-1816 A local-model seat reads its predecessor's knowledge brief first
  BL-1815 keeps the outgoing Claude seat's knowledge brief on disk when a
  local model takes the role. A local-model seat boots from its composed
  prompt, the compact card BL-1798 caps at 8192 characters, so the brief
  reaches it the way an overlay does: one line in the card pointing at the
  brief file, never the brief inlined. The pointer appears while the brief
  is fresh, so a local seat that restarts the same day is told again. A
  seat of any other agent composes exactly as before.

  Background:
    Given a fixture repository with a knowledge brief kept for the "coder" role

  # BL-1816 fresh-brief-pointer-in-the-card-01
  Scenario: a local-model coder composed while the brief is fresh is pointed at it
    Given the brief was captured 2 hours ago
    When the "local-model" prompt for "coder" is composed
    Then the composed prompt has exactly one line naming the brief file and saying to read it before the first ready_for_next.sh
    And the composed prompt is at most 8192 characters

  # BL-1816 stale-brief-no-pointer-02
  Scenario: a brief older than 24 hours is no longer pointed at
    Given the brief was captured 25 hours ago
    When the "local-model" prompt for "coder" is composed
    Then the composed prompt names no brief file

  # BL-1816 other-agents-compose-as-before-03
  Scenario Outline: a <agent> coder composes exactly as it would with no brief kept
    Given the brief was captured 2 hours ago
    When the "<agent>" prompt for "coder" is composed
    Then the composed prompt is identical to the one composed with no brief kept

    Examples:
      | agent  |
      | claude |
      | aider  |
