Feature: parcel age credits recorded clean downtime, never a crash

  # BL-639: flow_watchdog_lib.bb's parcel-age-ms is pure wall-clock, so a
  # planned stop-and-restart counts fully against every in-flight parcel and
  # fires ESCALATE for parcels that barely stalled. Fix credits ONLY downtime
  # bounded by a recorded "kill_all_swarm SUCCESS — clean slate" audit-log
  # entry on one side and daemon boot on the other — a crash writes no such
  # record and gets no credit, so a genuine crash-loop stall still alarms.

  # BL-639 clean-downtime-credited-01
  Scenario: a parcel enqueued shortly before a clean stop does not escalate across the outage
    Given a parcel was enqueued 4 minutes before a recorded clean stop
    And the clean stop's audit-log entry precedes a 2-hour outage
    When handoffd restarts and sweeps
    Then the parcel does not escalate

  # BL-639 live-prestall-not-swallowed-02
  Scenario: genuine pre-stop stall time survives the downtime credit
    Given a parcel stalled 40 minutes while the swarm was live before a recorded clean stop
    And the clean stop is followed by a 2-hour outage
    When handoffd restarts and sweeps
    Then the parcel escalates

  # BL-639 live-stall-past-escalate-ms-unchanged-03
  Scenario: a parcel stalled past escalate-ms entirely while live still alarms
    Given a parcel has been stalled past escalate-ms with no stop or restart involved
    When handoffd sweeps
    Then the parcel escalates

  # BL-639 crash-grants-no-credit-04
  Scenario: a crash restart grants no downtime credit
    Given handoffd stops without writing a "kill_all_swarm SUCCESS" audit-log entry
    And a 2-hour gap follows before it restarts
    When handoffd restarts and sweeps
    Then every in-flight parcel's age is unchanged by the gap
    And a parcel stalled past escalate-ms before the crash still escalates

  # BL-639 credited-window-is-visible-05
  Scenario: the credited downtime is visible in the alarm output
    Given a parcel's age spans a recorded clean-stop outage
    When handoffd sweeps and reports the parcel's age
    Then the report states how much downtime was credited
