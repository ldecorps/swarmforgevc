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
