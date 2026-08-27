Feature: The chase sweep leaves ambulance-held parcels alone

  BL-655 promised that engaging an ambulance holds every other parcel
  "byte-identical, never delivered, dropped, quarantined, abandoned or
  rewritten", and wired that promise into three decision points: daemon
  delivery, dequeue, and mono-router rotation actionability. BL-691 found a
  fourth mover it missed — the synchronous inject path. This is a fifth, and
  it is the only one that does not merely move a held parcel but can destroy
  it: the chase sweep.

  The chase sweep watches `inbox/new/` — which is exactly where BL-655 parks
  held parcels, on purpose, forever, by design. It has never read the marker.
  So it sees a parcel that nobody is claiming and concludes the recipient is
  stalled: it wakes the role, and once the chase count passes the maximum it
  escalates to a forced respawn or moves the parcel to `.dead`. A dead-letter
  is a quarantine of a parcel a human explicitly asked to be left alone, which
  is precisely the guarantee the mode was built to make.

  Measured on the live swarm during the 2026-08-07 BL-848 ambulance: four
  held documenter parcels drew 104 forced respawns in four hours, one chase
  sidecar reached 184, and the held coder note sat at chase count 5 against a
  maximum of 3 — one quiet window away from being dead-lettered. Each wake
  the resident does answer costs a turn that ends in NO_TASK, and a repeated
  NO_TASK spin is what the endless-loop circuit breaker hard-stops the whole
  swarm for. The mode meant to protect one ticket can take down the swarm.

  The fix is the one BL-655 already established and BL-691 restated as an
  invariant: consult the same predicate, at this site too. A held parcel is
  invisible to the sweep — no wake, no count, no respawn, no dead-letter, no
  write of any kind. What must NOT change is everything else: the patient's
  own parcels are the one thing a human most needs to hear is stuck, and with
  the mode off every decision stays exactly as it is today. A fix that quiets
  more than the human held would be worse than the defect.

  Background:
    Given a running swarm with a mailbox for every role
    And ambulance mode is engaged for BL-654

  # BL-852 chase-sweep-ambulance-01
  Scenario: a held parcel past the chase timeout is not chased
    Given a git_handoff for task BL-660 has waited in the documenter inbox past the chase timeout
    When the handoff daemon runs one chase sweep
    Then no wake-up is sent to documenter
    And no chase telemetry is recorded for that parcel
    And that parcel and its sidecars are byte-identical to before the sweep

  # BL-852 chase-sweep-ambulance-02
  Scenario Outline: a held parcel is never respawned or dead-lettered, whatever the recipient looks like
    Given a git_handoff for task BL-660 has waited in the documenter inbox past the chase timeout
    And its chase count has already reached the maximum
    And documenter liveness reads <liveness>
    When the handoff daemon runs one chase sweep
    Then no respawn is triggered for documenter
    And no dead-letter file is created for that parcel
    And that parcel and its sidecars are byte-identical to before the sweep

    Examples:
      | liveness |
      | alive    |
      | idle     |
      | unknown  |
      | dead     |
      | stuck    |

  # BL-852 chase-sweep-ambulance-03
  Scenario: the patient's own parcel is chased exactly as it would be with no ambulance
    Given a git_handoff for task BL-654 has waited in the coder inbox past the chase timeout
    When the handoff daemon runs one chase sweep
    Then a wake-up is sent to coder
    And that parcel's chase count is one higher than before the sweep

  # BL-852 chase-sweep-ambulance-04
  Scenario: releasing the ambulance resumes the chase ladder from the count the parcel was held at
    Given a git_handoff for task BL-660 has waited in the documenter inbox past the chase timeout
    And it has been held unchanged across three chase sweeps
    When the ambulance is released
    And the handoff daemon runs one chase sweep
    Then a wake-up is sent to documenter
    And that parcel's chase count is one higher than it was when the ambulance was engaged

  # BL-852 chase-sweep-ambulance-05
  Scenario: a held parcel whose work is already recorded as finished is still reaped
    Given a git_handoff for task BL-660 has waited in the documenter inbox past the chase timeout
    And a parcel with the same name is already recorded in the documenter completed folder
    When the handoff daemon runs one chase sweep
    Then that parcel is removed from the documenter inbox
    And no wake-up is sent to documenter

  # BL-852 chase-sweep-ambulance-06
  Scenario: a claim already in progress is still nudged while the ambulance is engaged
    Given a git_handoff for task BL-660 is already claimed in the documenter in_process folder
    And documenter has been idle past the stuck timeout
    When the handoff daemon runs one chase sweep
    Then a wake-up is sent to documenter

  # BL-852 chase-sweep-ambulance-07
  Scenario: with no ambulance engaged the sweep decides exactly as it does today
    Given the ambulance is released
    And a git_handoff for task BL-660 has waited in the documenter inbox past the chase timeout
    When the handoff daemon runs one chase sweep
    Then the sweep outcome matches what the same fixture produces with no marker file at all
