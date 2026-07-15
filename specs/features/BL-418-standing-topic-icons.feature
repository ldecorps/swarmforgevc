# mutation-stamp: sha256=e912cb610f0afb004af7eb9bd7eb3c861dcec7c14470bfe992c2e723691be4a8
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-15T17:05:25.867823204Z","feature_name":"the standing non-ticket topics carry their orchestra icons","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-418-standing-topic-icons.feature","background_hash":"f8a0f5b90dd0e32b0356487908b2a989f6a8e1f2f56bfed9503a190c6ec12f91","implementation_hash":"unknown","scenarios":[{"index":0,"name":"each standing topic resolves to its orchestra icon","scenario_hash":"0ffdd6e0cb1f292bd6a796206772068e5f431315c7ea46effcf0af7328c56a98","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-07-15T17:05:25.867823204Z"}]}
# acceptance-mutation-manifest-end

Feature: the standing non-ticket topics carry their orchestra icons

  # The orchestra remap's harder half: today the concierge only sets icons on
  # TICKET topics (folder+type transitions). This extends iconization to the
  # standing NON-ticket topics — support/intake (box office) and the Operator
  # topic (opera house) — while preserving BL-342's ownership rule exactly.

  Background:
    Given the concierge maintains icons for the standing non-ticket topics

  # BL-418 standing-topic-icons-01
  Scenario Outline: each standing topic resolves to its orchestra icon
    Given the "<topic>" standing topic
    When its icon is resolved
    Then the icon is "<icon>"

    Examples:
      | topic          | icon |
      | support/intake | 🎟   |
      | operator       | 🏛   |

  # BL-418 standing-topic-icons-02
  Scenario: a human-customised standing-topic icon the swarm did not set is never overwritten
    Given a standing topic whose current icon was set by a human, not the swarm
    When the concierge evaluates that topic's icon
    Then the concierge leaves the existing icon untouched

  # BL-418 standing-topic-icons-03
  Scenario: a standing-topic icon absent from the live sticker set skips rather than crashes
    Given the live topic-icon sticker set does not contain a standing topic's icon
    When the concierge tries to set that topic's icon
    Then no icon is set for that topic and the tick does not fail
