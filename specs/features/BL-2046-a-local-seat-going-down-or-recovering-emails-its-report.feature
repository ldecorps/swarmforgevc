Feature: BL-2046 A local seat going down or recovering emails its report

  BL-2045 gives a one-line way to email a local-model seat's health report
  on an event. The human also asked to hear when the iq3 seat goes down or
  recovers. Since BL-2038 a local seat restarts its session at every phase
  end, so it is briefly down many times an hour; an email for each would
  bury the real outages. After this parcel the babysitter's sweep reports
  each local-model seat's state, and an email goes out only when the seat
  has been down for ten minutes, and again when a seat that was reported
  down is back.

  Background:
    Given a fixture project whose swarmforge.conf sets notify_email_to and which has a local-model seat coder

  # BL-2046 a-brief-restart-sends-nothing-01
  Scenario: a seat down for less than ten minutes sends no email
    Given seat coder has read as down for 4 minutes
    When the babysitter sweep runs
    Then no email is sent

  # BL-2046 a-ten-minute-outage-sends-down-once-02
  Scenario: a seat down for ten minutes sends one down email, once
    Given seat coder has read as down for 11 minutes
    When the babysitter sweep runs twice
    Then exactly one email is sent, naming seat coder and the event down

  # BL-2046 recovery-after-a-down-email-03
  Scenario: a seat that was reported down and is generating again sends one recovered email
    Given a down email was sent for seat coder
    And seat coder now reads as generating
    When the babysitter sweep runs
    Then exactly one email is sent, naming seat coder and the event recovered
