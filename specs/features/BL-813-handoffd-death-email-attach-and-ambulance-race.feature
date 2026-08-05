Feature: BL-813 handoffd death alarm attaches its failure log
  A handoffd daemon death must remain an alarm-and-halt event, not an
  auto-restart. The death alarm also has to carry enough evidence for an
  off-box operator to diagnose the crash, and the ambulance ticket lookup that
  triggered this incident must degrade instead of throwing when a backlog file
  moves between the glob and the read.

  Background:
    Given BL-144 still alarms and halts the swarm on daemon death with no auto-restart
    And daemon_alarm_lib already supports Resend attachments for briefing diagrams (BL-286)

  # BL-813 handoffd-death-email-attach-and-ambulance-race-01
  Scenario: death alarm email includes the failure log as an attachment
    Given alarm-and-halt! has written handoffd-failure-<stamp>.log
    When the configured alarm email is sent
    Then the email body still names the failure-log path and ./swarm ensure
    And the email carries one attachment whose filename is that failure log
    And the attachment bytes match the written failure-log content
    And a failure while building the attachment does not prevent halt-swarm!

  # BL-813 handoffd-death-email-attach-and-ambulance-race-02
  Scenario: ticket-has-file? does not throw when a globbed yaml vanishes mid-read
    Given fs/glob listed backlog/active/BL-812-handoffd-cwd-breaks-mono-router-wake-remap.yaml
    And that file is moved to backlog/done/ before slurp
    When ticket-has-file? runs for that ticket id
    Then it returns false or finds the done/ copy without throwing
    And handoffd poll-once! continues

  # BL-813 handoffd-death-email-attach-and-ambulance-race-03
  Scenario: vanished-only ticket still degrades ambulance to off
    Given an ambulance marker names BL-999
    And no yaml under backlog/ declares id BL-999
    When read-ambulance-state is called
    Then active is false
    And the swarm is not crashed by the probe
