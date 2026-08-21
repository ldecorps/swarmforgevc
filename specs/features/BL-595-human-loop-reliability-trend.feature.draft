Feature: the front desk emits reliability telemetry the trend surface can plot

  # BL-595 (epic BL-594). The human<->swarm front desk emitted no reliability
  # telemetry at all, which is how BL-582's silently-failing approval tap
  # stayed invisible until a human noticed a stuck button. Four series, one
  # append-only log, the shared trend.ts framework. This ticket MEASURES
  # only - BL-582 owns fixing the tap and BL-566 the steer.
  #
  # Series 1-3 are categorical outcomes; series 4 is a duration. Scenario 04
  # carries both because the difference between them is which summary a
  # window reports, not how the aggregation is driven.

  Background:
    Given the front desk emits to the human-loop telemetry log

  # BL-595 every-front-desk-event-emits-one-record-01
  Scenario Outline: each front-desk event emits exactly one record carrying the outcome its own code computed
    When <event> completes with outcome <outcome>
    Then exactly one record is appended to the human-loop log
    And the record carries the outcome <outcome>
    And the record carries when it happened

    Examples:
      | event               | outcome        |
      | an approval tap     | recorded       |
      | an approval tap     | repaint-failed |
      | a steering delivery | delivered      |
      | a steering delivery | no-pane        |
      | a steering delivery | undelivered    |
      | a poll cycle        | degraded       |
      | a poll cycle        | conflict-409   |

  # BL-595 a-dropped-tap-keeps-its-reason-02
  Scenario Outline: a dropped tap records WHY it was dropped, not merely that it was
    When an approval tap is dropped because it is <reason>
    Then exactly one record is appended to the human-loop log
    And the record distinguishes <reason> from every other drop reason

    Examples:
      | reason            |
      | not-my-chat       |
      | not-principal     |
      | unrecognized-data |

  # BL-595 a-tick-emits-its-duration-03
  Scenario: a concierge tick emits how long it took, rather than an outcome
    When a concierge tick completes
    Then exactly one record is appended to the human-loop log
    And the record carries the tick's wall-clock duration

  # BL-595 each-series-aggregates-in-its-own-shape-04
  Scenario Outline: each series aggregates per window in the shape its data calls for
    Given a log of <kind> records spanning more than one window
    When the series is aggregated
    Then each window reports <summary>
    And the aggregation reads no files of its own

    Examples:
      | kind          | summary                          |
      | outcome       | its success rate                 |
      | tick-duration | a summary of the durations in it |

  # BL-595 measuring-never-degrades-what-it-measures-05
  Scenario Outline: the front desk survives a telemetry log it cannot write
    Given the human-loop log cannot be written
    When <event> is performed
    Then <event> still succeeds
    And the front desk is not left waiting on the log

    Examples:
      | event            |
      | an approval tap  |
      | a concierge tick |

  # BL-595 the-raw-log-is-append-only-06
  Scenario: a later emit appends to the log rather than rewriting it
    Given the human-loop log already holds earlier records
    When a further record is emitted
    Then the earlier records are still present unchanged
    And the log is excluded from version control
