# mutation-stamp: sha256=060564f36453b1a19bbddaae31e5907d72c5593d855c3b8ad2ec18416e7c163f
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-15T18:53:47.629660544Z","feature_name":"a paused ticket awaiting the human's approval gets a distinct topic icon","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-424-awaiting-approval-topic-icon.feature","background_hash":"0a2d6fdd570f8706f807f30c19ef778a7af8dc50890b17000b5d7a8533727ce9","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the icon state reflects both the folder and pending approval","scenario_hash":"dd95819311feb8777a277bab243c568177173f6900242c2c5a0d00f6beb59b12","mutation_count":20,"result":{"Total":20,"Killed":20,"Survived":0,"Errors":0},"tested_at":"2026-07-15T18:53:41.229249238Z"}]}
# acceptance-mutation-manifest-end

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
