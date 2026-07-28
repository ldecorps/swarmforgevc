Feature: flow-watchdog measures parcel age in active time, not wall-clock time

  # BL-650: parcel-age-ms is pure wall clock — it never subtracts swarm-stop
  # intervals, control/cooldown pauses, or provider outages. Under depth-1
  # rotation a broadcast parcel waiting its turn in a dormant role's inbox is
  # normal, not stalled, and the nightly 19:00-07:00 cooldown means every
  # parcel resting overnight accrues ~11-12h of wall age against a 15-minute
  # warn threshold — so the 07:00 auto-resume's first sweep would fire
  # ESCALATE on all of them at once, over parcels with zero active-time age.
  # decide-tier's structural guarantee (snoozed? is the ONLY mute, never a
  # role/type/dormancy branch) is preserved throughout: this ticket changes
  # what the clock measures, never whether the alarm may speak.

  # BL-650 stop-interval-not-counted-01
  Scenario: a swarm-stop interval does not count toward a parcel's effective age
    Given a parcel enqueued 1 minute before the swarm stopped
    And the swarm was stopped for 6 minutes
    And the swarm was then active for 8 minutes
    When the flow watchdog evaluates the parcel's age
    Then its effective age is 9 minutes
    And no warn fires at the 15-minute wall-clock mark

  # BL-650 overnight-cooldown-resume-no-storm-02
  Scenario: the 07:00 cooldown resume does not fire an escalation storm
    Given a parcel enqueued at the start of the nightly cooldown pause
    And the swarm remained paused all night until the 07:00 resume
    When the flow watchdog sweeps immediately after resume
    Then the parcel's effective age is approximately zero
    And nothing fires for that parcel

  # BL-650 active-ignored-parcel-still-alarms-03
  Scenario: a parcel ignored while the swarm is active still alarms
    Given a parcel has sat unprocessed for the full warn threshold while the swarm was active and unpaused
    When the flow watchdog sweeps
    Then a WARN fires
    Given that same parcel continues unprocessed to the escalate threshold of active time
    When the flow watchdog sweeps again
    Then an ESCALATE fires

  # BL-650 decide-tier-structural-guarantee-intact-04
  Scenario: decide-tier gains no role, type, or dormancy branch
    Given decide-tier's current inputs
    When this ticket's change is applied
    Then decide-tier's only mute remains snoozed?
    And no role, type, or dormancy branch has been added to its inputs

  # BL-650 unreconstructable-interval-degrades-to-wall-clock-05
  Scenario: an interval that cannot be reconstructed degrades to wall clock, flagged
    Given a pause or stop interval whose durable record is missing or unreliable
    When the flow watchdog evaluates a parcel spanning that interval
    Then the parcel's age falls back to wall clock for that interval
    And the alarm text flags that the interval could not be reconstructed

  # BL-650 rotation-pack-threshold-vs-parallel-pack-06
  Scenario Outline: rotation-aware thresholds apply only under a rotation pack
    Given a pack of type <pack type>
    And a broadcast parcel waiting a nominal rotation turn in a dormant role's inbox
    When the flow watchdog sweeps
    Then <alarm outcome>

    Examples:
      | pack type          | alarm outcome        |
      | rotation router    | no warn fires         |
      | parallel (all resident) | a warn still fires |

  # BL-650 alarm-text-states-clock-and-outage-07
  Scenario: the alarm text names which clock it used and any subtracted provider outage
    Given a parcel aged 9 minutes active out of 15 minutes wall, with 6 minutes subtracted for a provider outage
    When a WARN or ESCALATE fires for that parcel
    Then the alarm text reads its active age and its wall age
    And the alarm text names the subtracted provider-outage interval

  # BL-650 provider-outage-interval-tracked-per-provider-08
  Scenario: a provider-outage interval is tracked per provider and never merged into swarm downtime
    Given a 529 retry storm during an architect's review, backed by timestamped retry lines in the role transcript
    When the flow watchdog computes effective age for parcels in flight during that storm
    Then the retry-storm interval is subtracted from those parcels' effective age
    And that interval is recorded as its own provider-outage class, distinct from swarm-stop intervals
    And an interval with no signature evidence in the transcript subtracts nothing

  # BL-650 legitimate-prerequisite-detour-not-a-stall-09
  Scenario: a mono-router resident's legitimate prerequisite detour is not read as a stall
    Given a single resident is in_process on a parcel
    And the resident detours to another stage to satisfy that same parcel's own prerequisite
    And the resident returns to the original parcel shortly after
    When the flow watchdog sweeps during the detour
    Then no stall is alarmed for that parcel

  # BL-650 orphaned-claim-still-alarms-10
  Scenario: an in_process claim whose owner never returns still alarms
    Given a single resident claimed a parcel and then never returns to it
    When the flow watchdog sweeps past the warn threshold of active time
    Then a WARN still fires for that orphaned claim
