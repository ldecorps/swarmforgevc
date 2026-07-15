Feature: a paused ticket awaiting the human's approval gets a distinct topic icon

  # A paused ticket blocked ONLY on human_approval: pending (actionable by the
  # human right now) is today indistinguishable by icon from a paused ticket held
  # for any other reason (a dependency, an overlap hold, a deliberate park). It
  # gets its own icon state so the human can glance the topic list and see which
  # paused tickets need his approval. The marker is paused-scoped (an active or
  # done ticket is unaffected) and resolves against Telegram's live free icon set,
  # falling back to the plain paused icon when its glyph is unavailable.

  Background:
    Given the topic icon is resolved from a ticket's folder, type, and approval state

  # BL-424 approval-icon-state-01
  Scenario Outline: the icon state reflects both the folder and pending approval
    Given a "<type>" ticket in the "<folder>" folder with human_approval "<approval>"
    When its icon state is resolved
    Then the icon state is "<state>"

    Examples:
      | folder | type    | approval | state             |
      | paused | feature | pending  | awaiting-approval |
      | paused | feature | approved | paused            |
      | active | feature | pending  | feature           |
      | active | bug     | approved | defect            |
      | done   | feature | approved | done              |

  # BL-424 approval-icon-fallback-02
  Scenario: an unavailable awaiting-approval glyph falls back to the paused icon
    Given the awaiting-approval glyph is absent from Telegram's live forum-topic icon set
    And the paused glyph is present in that set
    When the icon sticker for a paused pending-approval ticket is resolved
    Then the plain paused icon sticker is used rather than failing
