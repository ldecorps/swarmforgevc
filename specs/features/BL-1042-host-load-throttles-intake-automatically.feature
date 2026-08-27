Feature: Sustained host load throttles intake without a human editing config

  Article 3.5 sanctions lowering the active-depth cap when host health
  degrades, and BL-431/432 automated exactly that loop for the rework signal.
  For host load the observation half is live - thousands of samples, still
  writing - but nothing turns it into a cap, so the throttle is driven by
  hand: on 2026-08-22 the cap was committed to 0 in the tracked pack conf and
  back to 4 hours later.

  The diagnosis is relative to the host's own recent baseline, over a
  sustained window, with a finite absolute ceiling behind it - because a
  permanently-loaded host has a high baseline and would otherwise never read
  as anomalous. An absolute-only threshold was measured and rejected: the
  existing ratio of 4 holds for 44.5% of two weeks of live samples.

  Both signals fold into the one recommendation slot the promotion path
  already reads, so the lower cap wins and the record still names its cause.

  Background:
    Given the promotion path resolving the effective active-depth cap

  # BL-1042 host-load-throttles-intake-automatically-01
  Scenario Outline: sustained load lowers the cap to the level its severity names
    Given host load has been <level> across the sustained window
    When the promotion path resolves the cap
    Then the effective cap is <cap>
    And the recorded recommendation names host load as the cause

    Examples:
      | level    | cap |
      | degraded | 1   |
      | severe   | 0   |

  # BL-1042 host-load-throttles-intake-automatically-02
  Scenario: a single spike does not throttle
    Given host load is quiet across the sustained window apart from one spike
    When the promotion path resolves the cap
    Then the effective cap is the configured cap

  # BL-1042 host-load-throttles-intake-automatically-03
  Scenario: recovery releases the throttle with no human action
    Given host load was throttling and has since recovered
    When the promotion path resolves the cap
    Then the effective cap is the configured cap
    And no tracked configuration file has been modified

  # BL-1042 host-load-throttles-intake-automatically-04
  Scenario: load sitting at the boundary does not oscillate the cap
    Given host load is sitting between the engage and release thresholds
    When the promotion path resolves the cap several times in a row
    Then the effective cap is the same every time

  # BL-1042 host-load-throttles-intake-automatically-05
  Scenario: when both signals recommend, the lower cap wins and is attributed
    Given a rework diagnosis and a host-load diagnosis recommending different caps
    When the promotion path resolves the cap
    Then the effective cap is the lower of the two
    And the recorded recommendation names the signal that produced it

  # BL-1042 host-load-throttles-intake-automatically-06
  Scenario: a recommendation never raises the cap
    Given a recommendation higher than the configured cap
    When the promotion path resolves the cap
    Then the effective cap is the configured cap
