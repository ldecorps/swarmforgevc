Feature: floored percentiles must not invent flow-watchdog warn thresholds

  Spec-dependent calibration (warn ≈ p67, escalate ≈ p97) is allowed to make
  a hop stricter than the global pair only when the raw percentile itself is
  a real residence. Clamping a sub-minute p67 up to min-warn-ms invents a
  threshold the history never showed, and the live daemon then WARNs healthy
  in_process work at ~1 minute (QA→coordinator|git_handoff, 2026-08-06).

  min-warn-ms is a reject gate: below it, the key is not emitted and
  resolution falls through. It is never a floor that publishes a fake
  calibrated warn.

  Background:
    Given a daemon state directory and a project config with the global warn and escalate pair

  # BL-835 floored-percentile-reject-01
  Scenario: a route whose raw p67 is below min-warn-ms is not calibrated
    Given a route with at least the minimum number of completed handoffs
    And every recorded residence on that route is below min-warn-ms
    When the threshold table is calibrated
    Then no exact-spec entry is emitted for that route
    And resolution for a parcel on that route falls through to the global pair

  # BL-835 floored-percentile-reject-02
  Scenario: a ~90s parcel on a sub-floor route does not WARN under the global pair
    Given a route whose history is entirely below min-warn-ms
    And a live parcel on that route aged about 90 seconds
    When the flow watchdog sweep runs
    Then no warn or escalate alarm is emitted for that parcel

  # BL-835 floored-percentile-reject-03
  Scenario: a route whose raw p67 clears the gate still calibrates and can WARN early
    Given a route with enough samples whose p67 is well above min-warn-ms
    And that p67 is still below the global warn
    And a live parcel on that route aged past the calibrated warn
    When the flow watchdog sweep runs
    Then a warn alarm is emitted for that parcel before the global warn would have fired

  # BL-835 floored-percentile-reject-04
  Scenario: decide-tier still never sees the route identity
    Given a parcel whose thresholds were resolved after a sub-floor key was rejected
    When the tier decision is made
    Then the decision input carries only an age and a threshold pair
    And it carries no from role, to role, type, or dormancy signal
