Feature: handoffd death alarm attaches failure log; ambulance ticket-has-file survives active→done race
  Host draft for specifier — amend scenarios freely. Evidence:
  backlog/evidence/handoffd-crash-ambulance-race-20260805.md
  Live crash: .swarmforge/daemon/handoffd-failure-20260805T141124Z.log

  Background:
    Given BL-144 still alarms and halts the swarm on daemon death with no auto-restart
    And daemon_alarm_lib already supports Resend attachments for briefing diagrams (BL-286)

  Scenario: death alarm email includes the failure log as an attachment
    Given alarm-and-halt! has written handoffd-failure-<stamp>.log
    When the configured alarm email is sent
    Then the email body still names the failure-log path and ./swarm ensure
    And the email carries one attachment whose filename is that failure log
    And the attachment bytes match the written failure-log content
    And a failure while building the attachment does not prevent halt-swarm!

  Scenario: ticket-has-file? does not throw when a globbed yaml vanishes mid-read
    Given fs/glob listed backlog/active/BL-812-….yaml
    And that file is moved to backlog/done/ before slurp
    When ticket-has-file? runs for that ticket id
    Then it returns false or finds the done/ copy without throwing
    And handoffd poll-once! continues

  Scenario: vanished-only ticket still degrades ambulance to off
    Given an ambulance marker names BL-999
    And no yaml under backlog/ declares id BL-999
    When read-ambulance-state is called
    Then active is false
    And the swarm is not crashed by the probe
