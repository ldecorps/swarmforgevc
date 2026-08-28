Feature: the briefing shift-velocity chart is readable at ordinary velocity

  # BL-1232 (epic swarm-behaviour-trends). Follow-on to BL-1184: rendering only.
  # The metric (max tickets landed per rolling 8h window per calendar day) and
  # the non-linear time axis are unchanged contracts, not this ticket's to move.

  Background:
    Given the briefing shift-velocity chart renderer
    And a shift-velocity series spanning thirty days of history

  # BL-1232 axis-fits-the-series-body-01
  Scenario Outline: the Y axis fits the body of the series
    Given <series_shape>
    When the briefing chart is rendered
    Then <axis_outcome>

    Examples:
      | series_shape                                          | axis_outcome                                                |
      | ordinary days under thirty and one day at four hundred | the axis maximum tracks the ordinary days, not the peak      |
      | no day more than double the busiest ordinary day       | the axis maximum covers the true peak and no day is clipped  |

  # BL-1232 clipped-peak-carries-its-value-02
  Scenario: a day above the axis cap stays findable on the chart
    Given ordinary days under thirty and one day at four hundred
    When the briefing chart is rendered
    Then the peak day is drawn as a clipped marker at the axis cap
    And that marker carries the peak's true value as text

  # BL-1232 date-labels-never-collide-03
  Scenario: date labels are picked by pixel spacing, not by index thirds
    When the briefing chart is rendered
    Then every pair of rendered date labels is at least the minimum label gap apart
    And the most recent day carries a date label

  # BL-1232 recent-gap-does-not-dominate-04
  Scenario: no single day-to-day gap swallows the plot width
    When the briefing chart is rendered
    Then the oldest day plots leftmost and the newest day plots rightmost
    And no consecutive pair of days is separated by more than half the plot width

  # BL-1232 non-linear-axis-contract-preserved-05
  Scenario: the locked non-linear time axis survives the readability fix
    When the briefing chart is rendered
    Then the time axis still reports non-linear spacing
    And recent days occupy more width than equally-spaced older days
