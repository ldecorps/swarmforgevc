# The human's directive, 2026-07-23, epic BL-594: "an analysis of the trend has
# to be published as part of the morning briefing."
#
# The nine BL-594 series all landed and are registered in
# `extension/src/metrics/trendsBoardRegistry.ts` (`TRENDS_BOARD_SERIES`), and
# BL-603 already publishes them as CHARTS on the live Mini App console. What is
# missing is the reading: direction, magnitude, and a one-line "so what", in
# the morning briefing itself.
#
# "Analysis, not charts" is the load-bearing word, and its sharp edge is that
# the narrative is a RENDERING of the computed trend, never a second,
# hand-tuned judgement that could disagree with the chart beside it. The
# computation is `computeTrend` (`extension/src/metrics/trend.ts`): latest
# period against the one before it, yielding `direction` (up/down/flat, or
# `unknown` on fewer than two points) and `delta`. Scenario 01 pins the
# agreement per case; invariant 1 pins it for every series and every shape of
# data.
#
# The honesty rule the board already keeps (`trendsBoard.ts`: "Nothing here
# ever substitutes a zero, a flat line, or an interpolated value for a missing
# point") carries into the narrative unchanged: a series with too few points to
# trend is OMITTED. Absence of data is not a finding, and "no change" is a
# claim this section may only make when it has the data to make it - which is
# exactly `computeTrend`'s own distinction between `flat` and `unknown`.
#
# The briefing is a phone read (BL-392's bounded-subject discipline applies to
# the body too), so the section is ranked by significance and bounded: it leads
# with the trend that moved most, and it stops.

Feature: The morning briefing carries a trend analysis, not just charts

  Background:
    Given the morning briefing's trend-analysis section built over the registered behaviour-trend series

  # BL-604 morning-briefing-trend-analysis-01
  Scenario Outline: each analysed series reads as a direction, a magnitude and one line of significance
    Given a registered series whose latest period is <current> and whose prior period is <prior>
    When the trend analysis is built
    Then its bullet for that series states the direction "<direction>"
    And its bullet states the magnitude <delta>
    And its bullet carries one line of significance

    Examples:
      | current | prior | direction | delta |
      | 82      | 98    | down      | -16   |
      | 12      | 4     | up        | 8     |
      | 7       | 7     | flat      | 0     |

  # BL-604 morning-briefing-trend-analysis-02
  Scenario: the section leads with the trend that moved most and stops at its bound
    Given registered series whose latest periods moved by different magnitudes
    When the trend analysis is built
    Then the bullets are ordered by significance, largest first
    And the section carries no more bullets than its declared maximum

  # BL-604 morning-briefing-trend-analysis-03
  Scenario Outline: a series without enough data to trend is omitted, never reported as no change
    Given a registered series with <points> recorded periods
    When the trend analysis is built
    Then the section carries no bullet for that series

    Examples:
      | points |
      | 0      |
      | 1      |

  # BL-604 morning-briefing-trend-analysis-04
  Scenario: a series whose loader throws is dropped and the briefing still sends
    Given a registered series whose loader throws
    When the morning briefing is sent
    Then the section carries no bullet for that series
    And the briefing is sent with its other sections intact

  # BL-604 morning-briefing-trend-analysis-05
  Scenario: the analysis reaches the briefing that is actually sent
    Given the morning briefing sweep runs with every wired section adapter
    When the briefing email is composed
    Then the sent body contains the trend-analysis section
