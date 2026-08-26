Feature: Front-desk give-up escalation emails once per unbroken outage episode
  After the front-desk bridge (or bot) exhausts its restart budget, the
  supervisor emails "has given up restarting". After FRONT_DESK_GIVEUP_COOLDOWN_MS
  the child re-arms with a fresh attempt budget; if it burns that budget
  again without a healthy recovery, escalate-gave-up! resets arming and
  emails again — a metronome every ~15 minutes for the same unbroken outage.

  The human gets one actionable signal per incident, not a repeating mail
  for the same failure episode.

  Background:
    Given the front-desk supervisor escalates give-up via daemon-alarm email
    And give-up cooldown re-arms the child with a fresh attempt budget

  # BL-1151 front-desk-giveup-one-email-per-episode-01
  Scenario: A continuous give-up cooldown re-arm loop sends at most one escalation email
    Given the bridge has entered give-up and an escalation email was delivered
    And the child has not been observably healthy since that give-up
    When give-up cooldown elapses and the child re-arms then burns its attempt budget again
    Then no second escalation email is sent for that same unbroken episode

  # BL-1151 front-desk-giveup-new-episode-may-email-02
  Scenario: A new episode after a real healthy period may email again
    Given a prior give-up episode already emailed once
    And the child later stays observably healthy for the grace window
    When the child later exhausts its restart budget again
    Then a new escalation email may be sent for the new episode

  # BL-1151 front-desk-giveup-rearm-keeps-armed-03
  Scenario: Leaving gave-up for re-armed without healthy grace does not re-open email
    Given escalation was armed after a delivered give-up email
    When status leaves gave-up only because of cooldown re-arm (no healthy grace)
    Then escalation arming stays such that the next give-up of the same episode does not email again
