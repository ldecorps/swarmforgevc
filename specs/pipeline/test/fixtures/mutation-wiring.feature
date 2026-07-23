Feature: BL-113 mutation wiring fixture (test-only, not a real ticket)

Scenario Outline: an asserted example value is load-bearing
  Given three items exist
  Then the count is <count>

  Examples:
    | count |
    | 3     |

Scenario Outline: an unused example value is not load-bearing
  Given three items exist
  Then the count was merely accepted as <count>

  Examples:
    | count |
    | 3     |
