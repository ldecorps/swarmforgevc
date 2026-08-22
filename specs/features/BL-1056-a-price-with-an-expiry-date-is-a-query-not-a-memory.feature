Feature: A price with an expiry date is a query, not a memory

  The pricing table has no notion of time, so a rate that is only valid until
  a date cannot be expressed. Today that overstates every Sonnet seat by 50%
  inside its introductory window, and on the day the window closes the real
  bill rises with no signal at all.

  This feature makes prices honest about time and makes the cliff answerable.
  The scheduled economic review and its descent ladder are a later slice and
  are asserted nowhere here.

  # BL-1056 price-validity-window-01
  Scenario Outline: a windowed rate is resolved for the instant being costed
    Given "claude-sonnet-5" is priced at "2" per input Mtok until "2026-08-31", then "3"
    When one input Mtok is costed at "<instant>"
    Then the cost is "<cost>"

    Examples:
      | instant    | cost |
      | 2026-08-22 | 2    |
      | 2026-08-31 | 2    |
      | 2026-09-01 | 3    |

  # BL-1056 price-validity-window-02
  Scenario Outline: a model with no window is costed identically at every instant
    Given "claude-opus-5" is priced at "5" per input Mtok with no window
    When one input Mtok is costed at "<instant>"
    Then the cost is "5"

    Examples:
      | instant    |
      | 2026-08-22 |
      | 2026-09-01 |

  # BL-1056 price-validity-window-03
  Scenario: an instant no window covers fails loud rather than costing at zero
    Given "some-model" is priced only for instants before "2026-08-31"
    When one input Mtok is costed at "2026-09-01"
    Then costing fails loud
    And no cost is reported

  # BL-1056 price-validity-window-04
  Scenario: an unpriced model still fails loud, unchanged
    Given "unpriced-model" has no pricing entry
    When one input Mtok is costed at "2026-08-22"
    Then costing fails loud

  # BL-1056 price-validity-window-05
  Scenario: the staleness query names a window that has closed
    Given "claude-sonnet-5" is priced at "2" per input Mtok until "2026-08-31", then "3"
    When the staleness query is run at "2026-09-01"
    Then it names "claude-sonnet-5"
    And it names the boundary date "2026-08-31"

  # BL-1056 price-validity-window-06
  Scenario: the staleness query names a window that is about to close
    Given "claude-sonnet-5" is priced at "2" per input Mtok until "2026-08-31", then "3"
    When the staleness query is run at "2026-08-22"
    Then it names "claude-sonnet-5"

  # BL-1056 price-validity-window-07
  Scenario: the staleness query says nothing about a model with no window
    Given "claude-opus-5" is priced at "5" per input Mtok with no window
    When the staleness query is run at "2026-09-01"
    Then it does not name "claude-opus-5"
