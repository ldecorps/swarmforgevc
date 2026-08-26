Feature: The morning-briefing burndown carries a projected ETA when the backlog is actually shrinking, and says why when it is not

  # BL-910 (epic BL-594 swarm-behaviour-trends): the not-done burndown
  # (extension/src/metrics/notDoneBurndown.ts) already computes everything an honest
  # projection needs — openN, closePerDay, mintPerDay — and prints them in its own
  # subtitle, but shows only the trailing line. The human asked for a projected ETA
  # readable at a glance, with one hard condition: never invent a date when net flow is
  # still growing. Net burn is close per day minus mint per day; a positive net burn gives
  # openN / netBurn days, and anything else gives the reason instead of a number. The ETA
  # is repo-wide open count and is labelled as such, deliberately distinct from BL-228's
  # milestone p50/p85 forecast — two forecasters that disagree silently would be worse
  # than one.

  # BL-910 shrinking-backlog-projects-a-date-01
  Scenario Outline: a backlog that is closing faster than it fills projects a date from its own numbers
    Given the burndown reports <open> open tickets
    And a close rate of <close> per day and a mint rate of <mint> per day
    When the burndown is rendered
    Then a projected ETA of <days> days is shown

    Examples:
      | open | close | mint | days |
      | 100  | 6.0   | 4.0  | 50   |
      | 30   | 5.0   | 2.0  | 10   |
      | 7    | 3.5   | 3.0  | 14   |

  # BL-910 no-fabricated-eta-when-not-shrinking-02
  Scenario Outline: a backlog that is growing or holding steady shows the reason instead of a date
    Given the burndown reports 180 open tickets
    And a close rate of <close> per day and a mint rate of <mint> per day
    When the burndown is rendered
    Then no projected date is shown
    And the reason the backlog is not shrinking is shown

    Examples:
      | close | mint |
      | 4.0   | 6.0  |
      | 5.0   | 5.0  |
      | 0.0   | 0.0  |

  # BL-910 the-eta-agrees-with-the-numbers-beside-it-03
  Scenario: the projected ETA is derivable from the counts the chart itself prints
    Given the burndown reports 100 open tickets
    And a close rate of 6.0 per day and a mint rate of 4.0 per day
    When the burndown is rendered
    Then the subtitle still reports 100 open tickets
    And the subtitle still reports a close rate of 6.0 per day and a mint rate of 4.0 per day
    And a projected ETA of 50 days is shown

  # BL-910 the-eta-says-what-it-is-a-forecast-of-04
  Scenario: the projected ETA is labelled as the repo-wide open-ticket projection
    Given the burndown reports 100 open tickets
    And a close rate of 6.0 per day and a mint rate of 4.0 per day
    When the burndown is rendered
    Then the projected ETA is labelled as covering all open tickets
    And the projected ETA is not presented as a milestone forecast

  # BL-910 the-heading-is-unchanged-05
  Scenario: the chart is still headed a burndown
    Given the burndown reports 100 open tickets
    And a close rate of 6.0 per day and a mint rate of 4.0 per day
    When the burndown is rendered
    Then the heading still calls the chart a burndown
