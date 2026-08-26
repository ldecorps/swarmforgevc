Feature: the flow watchdog measures each hop against that hop's own history

  One flat 15-minute warn is wrong in both directions. Under a rotation pack a
  15-minute wait in a dormant role's inbox is a nominal rotation turn rather
  than a stall, and a hop whose own history says minutes should not have to
  wait out fifteen. Calibrating warn and escalate per route — from the mailbox
  residence that route has actually shown — makes the same alarm mean the same
  thing on every hop.

  A route only earns a stricter-than-global threshold when its raw percentile
  itself clears min-warn-ms. A sub-minute route (a QA-to-coordinator note that
  completes in seconds) is not calibrated at all and keeps the global pair:
  min-warn-ms is a reject gate, never a floor that publishes a threshold the
  history never showed (BL-835).

  Threshold resolution happens outside decide-tier, so the structural guarantee
  that decide-tier never grows a role, type or dormancy branch is preserved:
  spec dependence changes which numbers are fed in, never whether the alarm may
  speak.

  Background:
    Given a daemon state directory and a project config with the global warn and escalate pair

  # BL-827 flow-watchdog-spec-dependent-thresholds-01
  Scenario: a hop with enough history is measured against its own percentiles
    Given a route whose completed handoffs show a mailbox residence below the global warn and above min-warn-ms
    And that route has at least the minimum number of samples
    When the flow watchdog sweep runs over a parcel on that route
    Then the parcel is measured against the calibrated warn for that route
    And it alarms before the global warn threshold would have fired

  # BL-827 flow-watchdog-spec-dependent-thresholds-02
  Scenario Outline: a route without enough history falls through to the next coarser key
    Given a route with fewer completed handoffs than the minimum number of samples
    And <coarser source> has enough samples to calibrate
    When the flow watchdog sweep runs over a parcel on that route
    Then the thresholds are resolved from <coarser source>

    Examples:
      | coarser source                  |
      | the same recipient and type     |
      | the global config pair          |

  # BL-827 flow-watchdog-spec-dependent-thresholds-03
  Scenario: decide-tier still never sees the route identity
    Given a parcel whose thresholds were resolved from a calibrated route
    When the tier decision is made
    Then the decision input carries only an age and a threshold pair
    And it carries no from role, to role, type, or dormancy signal

  # BL-827 flow-watchdog-spec-dependent-thresholds-04
  Scenario: the alarm says which threshold it fired against
    Given a parcel that alarms on a calibrated route threshold
    And a second parcel that alarms on the global fallback pair
    When each alarm is emitted
    Then each alarm text names the threshold it used and where that threshold came from

  # BL-827 flow-watchdog-spec-dependent-thresholds-05
  Scenario: calibration does not re-walk the audits on every sweep
    Given a calibrated table written less than the recalibration interval ago
    When the flow watchdog sweep runs
    Then the existing table is reused
    And no completed or abandoned audit is re-read

  # BL-827 flow-watchdog-spec-dependent-thresholds-06
  Scenario: a calibration failure never disables the watchdog
    Given a calibrated table that is stale
    And recalibration fails
    When the flow watchdog sweep runs
    Then the previous table stays in place
    And every parcel is still evaluated and still able to alarm

  # BL-827 flow-watchdog-spec-dependent-thresholds-07
  Scenario: a flat sample never collapses the two tiers into one
    Given a sample set in which every recorded residence is identical
    When its thresholds are calibrated
    Then the escalate threshold is strictly above the warn threshold
