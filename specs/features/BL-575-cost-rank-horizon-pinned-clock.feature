Feature: swarm-cost-rank selects records by horizon against a pinned clock

  The ranked-cost CLI filters ledger records to a horizon (3h/24h/7d) computed
  from the current time. Its test fixture writes records at a hardcoded
  absolute instant, so the suite passed on the day it was written and began
  failing permanently once that instant aged past the 24h boundary — a time
  bomb, not a code regression.

  The behavior below is therefore specified against an explicitly pinned clock,
  so the same run gives the same answer on any calendar day.

  Background:
    Given the current time is pinned to "2026-07-22T12:00:00Z"

  # BL-575 cost-rank-horizon-01
  Scenario Outline: a record is ranked only when it falls inside the requested horizon
    Given a ledger record timestamped "<record_time>" costing 1 USD
    When swarm-cost-rank runs for horizon "24h"
    Then the ranked output holds <count> records

    Examples:
      | record_time          | count |
      | 2026-07-22T11:00:00Z | 1     |
      | 2026-07-20T11:00:00Z | 0     |

  # BL-575 cost-rank-ordering-02
  Scenario: records inside the horizon are ranked by cost descending
    Given a ledger record timestamped "2026-07-22T11:00:00Z" costing 1 USD
    And a ledger record timestamped "2026-07-22T10:00:00Z" costing 5 USD
    When swarm-cost-rank runs for horizon "24h"
    Then the ranked costs are 5 then 1

  # BL-575 cost-rank-groupby-03
  Scenario: a groupBy dimension rolls the in-horizon records into groups
    Given a ledger record timestamped "2026-07-22T11:00:00Z" for role "coder"
    And a ledger record timestamped "2026-07-22T10:00:00Z" for role "cleaner"
    When swarm-cost-rank rolls up horizon "24h" by role
    Then the ranked output holds 2 groups

  # BL-575 cost-rank-subprocess-04
  Scenario: the compiled CLI honours the pinned clock when run as a subprocess
    Given a ledger record timestamped "2026-07-22T11:00:00Z" costing 4 USD
    When the compiled CLI is run as a subprocess for horizon "24h"
    Then the ranked output holds 1 records
    And the reported total cost is 4 USD
