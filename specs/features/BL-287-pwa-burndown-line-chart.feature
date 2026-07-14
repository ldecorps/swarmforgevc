Feature: PWA burndown renders as a classic sprint line chart (remaining vs ideal)

  Background:
    Given the static backlog-dashboard PWA renders the burndown from each milestone's daily remaining series

  # BL-287 burndown-line-01
  Scenario: the remaining counts are drawn as a connected line over dates
    Given a milestone with a daily series of remaining ticket counts
    When the burndown chart renders
    Then the remaining counts are drawn as one connected line across the dates

  # BL-287 burndown-line-02
  Scenario: date runs along the bottom and remaining ticket count up the side
    Given a milestone with a daily series of remaining ticket counts
    When the burndown chart renders
    Then date runs along the horizontal axis and remaining ticket count up the vertical axis

  # BL-287 burndown-line-03
  Scenario: a dotted ideal line falls straight from the starting count to zero
    Given a milestone whose remaining series starts above zero
    When the burndown chart renders
    Then a dotted ideal line runs straight from the starting count down to zero across the same dates

  # BL-287 burndown-line-04
  Scenario: a legend tells the remaining line apart from the ideal line
    Given a milestone with a daily series of remaining ticket counts
    When the burndown chart renders
    Then a legend labels the solid remaining line and the dotted ideal line distinctly

  # BL-287 burndown-line-05
  Scenario: with no milestone data the burndown shows its empty message and no chart
    Given no milestones with burndown data
    When the burndown section is drawn
    Then it shows the no-milestones message and draws no chart
