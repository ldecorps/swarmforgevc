Feature: BL-1317 Adapt-tier effort dial follows outcome signals

  BL-236 delivered Suggest-only. Adapt (auto-escalate on bounces) was
  deferred. BL-1316 sets a claim-time baseline from mutation_cost. This
  feature is Adapt: climb one notch on under-thinking signals; drop only
  after sustained clean work, never below the BL-1316 baseline for the
  held ticket.

  Background:
    Given a seat whose backend exposes a reasoning-effort setting
    And BL-1316 has set a claim-time baseline for the held ticket

  # BL-1317 bounce-climbs-one-notch-01
  Scenario: a bounce climbs effort one notch above the claim-time baseline
    Given the seat holds a ticket at medium claim-time effort
    When a bounce is recorded for that ticket on this seat
    Then the seat respawns at the next higher effort notch
    And the pack conf on disk is unchanged

  # BL-1317 clean-streak-may-drop-02
  Scenario: a clean streak may drop one notch but not below the claim-time baseline
    Given the seat has climbed above its claim-time baseline
    When the configured clean-completion streak is met
    Then the seat may drop one notch
    And the resulting effort is never below the BL-1316 baseline for that ticket

  # BL-1317 no-lever-skips-03
  Scenario: a backend with no effort lever never receives an unsupported flag
    Given a seat on a backend with no reasoning-effort setting
    When a bounce is recorded
    Then Adapt does not send an unsupported effort argument
