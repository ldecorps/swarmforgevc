Feature: The bounded fs.watch deadline follows recorded contention

  BL-933 raced a real fs.watch event against a short explicit deadline so a
  missing OS event fails fast with a readable message instead of consuming
  the whole lane budget. These scenarios keep that diagnostic while removing
  the bare constant the deadline was expressed as.

  Background:
    Given a bounded wait on a real fs.watch event

  # BL-1008 bounded-watch-deadline-01
  Scenario Outline: the deadline follows the recorded contention factor
    When the recorded contention factor is <factor>
    Then the bounded wait deadline is <deadline> ms

    Examples:
      | factor   | deadline |
      | 0.25     | 10000    |
      | 1        | 10000    |
      | 3        | 30000    |
      | unusable | 10000    |

  # BL-1008 bounded-watch-deadline-02
  Scenario Outline: the deadline stays strictly below the test's effective budget
    When the recorded contention factor is <factor>
    Then the bounded wait deadline is less than the test's effective budget

    Examples:
      | factor |
      | 1      |
      | 3      |
      | 1000   |

  # BL-1008 bounded-watch-deadline-03
  Scenario: a missing event still names the event and the watched path
    When the awaited event never arrives
    Then the failure message names the event label
    And the failure message names the watched path
