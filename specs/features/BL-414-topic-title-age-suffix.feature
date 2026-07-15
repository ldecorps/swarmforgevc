Feature: a topic's title shows how long ago it was last updated

  # Operator-relayed request: a glanceable cue for topic staleness. Telegram
  # topics support no colour gradient, and the icon already encodes ticket STATE
  # (BL-342), so the age rides the topic TITLE as a coarse suffix. It is bucketed
  # and change-gated (like BL-342/BL-394) so a topic is renamed only when its
  # staleness bucket changes, never on every tick.

  Background:
    Given a concierge tick maintaining a topic title with an age suffix reflecting its last-update time

  # BL-414 topic-title-age-suffix-01
  Scenario Outline: crossing into a staler bucket renames the title once with that bucket's suffix
    Given a topic whose last-announced staleness bucket is "<prev>"
    When a tick finds its time since last update now in bucket "<now>"
    Then the topic title is edited once to carry the "<now>" age suffix
    And the last-announced staleness bucket for that topic becomes "<now>"

    Examples:
      | prev    | now     |
      | fresh   | hours   |
      | hours   | day     |
      | day     | stale   |

  # BL-414 topic-title-age-suffix-02
  Scenario: an unchanged staleness bucket does not re-edit the title
    Given a topic whose last-announced staleness bucket is "hours"
    When a tick finds its time since last update still in bucket "hours"
    Then the topic title is not edited
    And the last-announced staleness bucket for that topic stays "hours"

  # BL-414 topic-title-age-suffix-03
  Scenario: new activity resets the age suffix to the freshest bucket
    Given a topic whose last-announced staleness bucket is "stale"
    When the topic receives new activity and a tick runs
    Then the topic title is edited to carry the "fresh" age suffix
    And the last-announced staleness bucket for that topic becomes "fresh"

  # BL-414 topic-title-age-suffix-04
  Scenario: the base ticket title is preserved when the age suffix changes
    Given a topic whose base title is "BL-999 do a thing" carrying an age suffix
    When a tick edits the title for a new staleness bucket
    Then the resulting title still begins with "BL-999 do a thing"
    And it carries exactly one age suffix, not an accumulation of stale ones
