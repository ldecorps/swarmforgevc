Feature: BL-1335 exhaustion evidence is promoted into the outage record BL-669 acts on

  Both halves of this path already exist and neither is broken. They are
  simply not connected.

  The PRODUCER runs: BL-840 wired `record-provider-outage!` into handoffd's
  live pane observation, and it writes constantly - on this host
  `.swarmforge/telemetry/provider-outage-2026-09.jsonl` is 180KB written
  today. The CONSUMER runs: `handoffd.bb:3914` calls
  `outage-driven-seat-failover!`, whose `evaluate-seat` reads the failover
  record store, consults the Model Steward registry, and decides an
  apply-at-idle substitution with the attended and unattended discipline
  already in place.

  But they read and write DIFFERENT files. The producer appends evidence to
  `provider-outage-YYYY-MM.jsonl`, whose own header notes "nothing else
  parses that file". The consumer reads `provider-outages.jsonl`, which
  holds exactly one line on this host, typed by a human -
  `"recordedBy": "operator-session"` - whose note says why: "Opened so
  BL-669 outage failover can restaff documenter". Its incident is "Token
  Plan weekly quota exhausted".

  So a human is the bridge today, and the incident they bridged was
  exhaustion. This slice promotes evidence that classifies as period or
  quota exhaustion into a failover record automatically. It adds no second
  failover path and no third store (BL-1178): it connects two things that
  are already running.

  Background:
    Given the swarm is recording provider-outage evidence from live panes
    And the outage failover consumer is running against the failover record store

  # BL-1335 exhaustion-evidence-opens-one-record-01
  Scenario: evidence of period exhaustion opens one well-formed failover record
    Given evidence that a seat's provider has exhausted its plan period quota
    When the exhaustion classifier reads that evidence
    Then one failover record is opened for that seat's provider and model
    And the record carries the period reset time the evidence reported

  # BL-1335 non-exhaustion-evidence-opens-nothing-02
  # The false-positive guard. Opening a record costs a seat swap, so
  # evidence that is not period exhaustion must never open one.
  Scenario Outline: evidence that is not exhaustion opens no failover record
    Given evidence that a seat's provider returned <failure>
    When the exhaustion classifier reads that evidence
    Then no failover record is opened

    Examples:
      | failure                    |
      | a transient network error  |
      | an authentication rejection|
      | malformed model output     |

  # BL-1335 repeat-evidence-opens-no-second-record-03
  # The producer is throttled but still writes repeatedly for one incident.
  Scenario: repeated evidence while a record is open opens no second record
    Given evidence that a seat's provider has exhausted its plan period quota
    And a failover record is already open for that seat's provider and model
    When the exhaustion classifier reads that evidence
    Then no failover record is opened

  # BL-1335 record-reaches-the-live-consumer-04
  # Proves the promotion feeds the ALREADY-WIRED consumer rather than being
  # green over a fake store of its own.
  Scenario: the opened record is what the failover consumer acts on
    Given evidence that a seat's provider has exhausted its plan period quota
    And the Model Steward has a certified substitute eligible for that seat
    When the failover consumer evaluates that seat at an idle boundary
    Then it proposes the certified substitute for that seat
