# mutation-stamp: sha256=86927256254b3fc226510446d99725cf3f954ead5035262136acd1c46be7f8e3
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-12T05:07:07.722222Z","feature_name":"Ambulance mode's perimeter — quiet, frozen, and self-releasing","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-679-ambulance-mode-perimeter.feature","background_hash":"f0ae6031941d3ef71b1786d7ba31f1f80acb26b022a965f1796e2c72429ffb91","implementation_hash":"unknown","scenarios":[{"index":5,"name":"the mode releases itself when the ticket leaves the pipeline","scenario_hash":"6fb342f962f63d496ef35dfe2d3f5ed723c6ef1eab03e0bd07ef1cea179f6ce6","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-12T05:07:07.722222Z"}]}
# acceptance-mutation-manifest-end

Feature: Ambulance mode's perimeter — quiet, frozen, and self-releasing

  BL-655 delivers the hold. This is what makes it a mode a human reaches for:
  the parcels the human deliberately held stop alarming, the backlog stops
  filling behind the ride, and the mode ends by itself when the patient is
  delivered — or when the patient leaves for a human ruling, which must
  release rather than starve.

  The mute goes through the flow-watchdog's EXISTING single mute channel. Its
  tier decision is structurally suppression-free by design and unit-tested to
  stay that way; an ambulance hold is a durable, visible, human-written
  acknowledgement, which is exactly what a snooze already means, so it
  composes at the caller and the decision function is untouched.

  Exit is one-directional. Nothing in here may ever engage an ambulance.

  Background:
    Given a running mono-router swarm with a mailbox for every role
    And the ambulance marker names BL-654

  # BL-679 ambulance-perimeter-01
  Scenario: parcels held by the ambulance stop alarming
    Given a parcel for BL-660 held past the escalate threshold
    When the flow watchdog sweep runs
    Then no alarm is emitted for BL-660

  # BL-679 ambulance-perimeter-02
  Scenario: the ambulance ticket's own stalled parcel alarms as it does today
    Given a parcel for BL-654 aged past the escalate threshold
    When the flow watchdog sweep runs
    Then an escalate alarm is emitted for BL-654

  # BL-679 ambulance-perimeter-03
  Scenario: the tier decision itself gains no ambulance branch
    When the tier decision's allowed input keys are inspected
    Then they are exactly the five keys it recognised before this slice

  # BL-679 ambulance-perimeter-04
  Scenario: no open-slot promotion nudge fires while the mode is engaged
    Given the active backlog is under its cap and paused work is eligible
    When the handoff daemon runs one sweep
    Then no promote-and-route nudge is sent to the coordinator

  # BL-679 ambulance-perimeter-05
  Scenario: an expedited critical defect filed mid-ambulance queues and is named first on release
    Given a critical defect BL-661 is filed while the mode is engaged
    When the handoff daemon runs one sweep
    Then BL-661 has not been promoted
    When the ambulance is released
    Then the release announcement names BL-661 before anything else it was holding

  # BL-679 ambulance-perimeter-06
  Scenario Outline: the mode releases itself when the ticket leaves the pipeline
    Given the BL-654 ticket file is <location>
    When the handoff daemon runs one sweep
    Then no ambulance is engaged
    And the announcement reports the <case> case

    Examples:
      | location            | case      |
      | in backlog/done     | delivered |
      | in backlog/hold     | abandoned |
      | absent from backlog | abandoned |

  # BL-679 ambulance-perimeter-07
  Scenario: a bounced ambulance ticket still in flight keeps the mode engaged
    Given the BL-654 ticket file is in backlog/active
    And a bounce note naming BL-654 has been sent back to the coder
    When the handoff daemon runs one sweep
    Then the ambulance marker still names BL-654
    And the bounce note is delivered to the coder

  # BL-679 ambulance-perimeter-08
  Scenario: the abandoned case is announced loudly rather than silently
    Given the BL-654 ticket file is in backlog/hold
    When the handoff daemon runs one sweep
    Then the announcement is emitted at the escalate level

  # BL-679 ambulance-perimeter-09
  Scenario: no sweep can ever engage an ambulance
    Given no ambulance is engaged
    And a critical defect is in flight and every parcel in the swarm is stalled
    When the handoff daemon runs one sweep
    Then no ambulance is engaged
