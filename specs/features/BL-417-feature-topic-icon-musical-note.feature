# mutation-stamp: sha256=e5849753513d697ea8957f849da846b05a7e4d3b74464a7a87980aacc707ad87
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-15T15:20:05.519280731Z","feature_name":"a feature-in-flight topic shows the musical-note icon","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-417-feature-topic-icon-musical-note.feature","background_hash":"77128d743a75e26489d42c92a27aa56d984244bf36a0d8f45eb9ae9364436f89","implementation_hash":"unknown","scenarios":[{"index":1,"name":"the other ticket-level states keep their existing icons","scenario_hash":"afd454b3c64a3b4bdd3211263d51ee0c80dc7a2fa6eaf51c04f49773f41f8dfe","mutation_count":9,"result":{"Total":9,"Killed":9,"Survived":0,"Errors":0},"tested_at":"2026-07-15T15:20:05.519280731Z"}]}
# acceptance-mutation-manifest-end

Feature: a feature-in-flight topic shows the musical-note icon

  # Part of the orchestra icon remap: within Telegram's free topic-icon sticker
  # set (no instruments/notation available), the feature-in-flight state moves
  # from the bulb to the musical note. The other ticket-level states keep their
  # icons — no musical stand-in beats them. Rides BL-342's existing automation.

  Background:
    Given the concierge resolves a ticket topic's icon from its folder and type

  # BL-417 feature-topic-icon-musical-note-01
  Scenario: an active feature ticket resolves to the musical-note icon
    Given an active ticket whose type is not a bug
    When its topic icon is resolved
    Then the icon is the musical note

  # BL-417 feature-topic-icon-musical-note-02
  Scenario Outline: the other ticket-level states keep their existing icons
    Given a ticket in folder "<folder>" whose type is "<type>"
    When its topic icon is resolved
    Then the icon is "<icon>"

    Examples:
      | folder | type    | icon |
      | done   | feature | ✅   |
      | active | bug     | 🦠   |
      | paused | feature | 🔍   |

  # BL-417 feature-topic-icon-musical-note-03
  Scenario: the musical note absent from the live sticker set skips rather than crashes
    Given the live topic-icon sticker set does not contain the musical note
    When the concierge tries to set a feature topic's icon
    Then no icon is set for that topic and the tick does not fail
