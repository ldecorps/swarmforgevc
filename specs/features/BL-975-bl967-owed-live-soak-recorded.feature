Feature: BL-975 BL-967's owed 30-minute live soak is run and its verdict recorded

  BL-967 landed with qa_e2e step 3 recorded by QA as owed, not passed - a
  read-only 30-minute post-landing observation of the handoffd freshness
  incident log and the daemon's own cycle log. This chore tracks running it
  and recording the verdict durably. The scenarios gate the recorded
  evidence artifact, because the observation itself is live wall-clock work
  no fixture can replay.

  Background:
    Given the recorded soak evidence file for this ticket under "backlog/evidence/"

  # BL-975 bl967-owed-live-soak-recorded-01
  Scenario: the evidence pins the observation window to post-fix daemons only
    Then the evidence names the first daemon start running BL-967's landed code, by start-audit timestamp
    And the evidence spans an observation window of at least 30 minutes from that start
    And the evidence lists the handoffd freshness-incident entries inside that window, or states there were none

  # BL-975 bl967-owed-live-soak-recorded-02
  Scenario: the verdict is coherent with the observed delta
    Then a zero-incident window with completed heartbeat cycles records verdict PASS
    And a window containing any handoffd freshness incident or attributed in-cycle timeout records the attributed sweep and call and names the follow-on ticket minted for it
